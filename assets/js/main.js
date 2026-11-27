
const ORDERS_JSON_URL = "./data/orders.json";

const STATUS_LABELS = {
  new: "جديد",
  on_the_way: "في الطريق",
  delivered: "تم التوصيل"
};

let ordersData = [];
let isRequestInFlight = false;
let loadStatus = "idle"; // "idle" | "loading" | "success" | "error" | "empty"
let lastErrorMessage = "";

let state = {
  statusFilter: "all",
  dateFrom: "",
  dateTo: "",
  minPrice: "",
  maxPrice: "",
  searchQuery: "",
  currentPage: 1,
  rowsPerPage: 20,
  visibleCols: {
    id: true,
    customer: true,
    address: false,
    items: true,
    status: true,
    total: true,
    created_at: true,
    actions: true
  }
};

function formatDate(isoStr) {
  const date = new Date(isoStr);
  return date.toLocaleString("ar-YE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(num) {
  return Number(num).toLocaleString("en-US");
}

function getOrderDateYMD(isoStr) {
  const date = new Date(isoStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getFilteredOrders() {
  return ordersData.filter((order) => {
    if (state.statusFilter !== "all" && order.status !== state.statusFilter) return false;

    const orderDate = getOrderDateYMD(order.created_at);
    if (state.dateFrom && orderDate < state.dateFrom) return false;
    if (state.dateTo && orderDate > state.dateTo) return false;

    if (state.minPrice !== "" && order.total < Number(state.minPrice)) return false;
    if (state.maxPrice !== "" && order.total > Number(state.maxPrice)) return false;

    const q = state.searchQuery.trim().toLowerCase();
    if (q && !String(order.customer || "").toLowerCase().includes(q)) return false;

    return true;
  });
}

function buildFilterSummary() {
  const parts = [];
  if (state.statusFilter !== "all") {
    parts.push(`الحالة: ${STATUS_LABELS[state.statusFilter] || state.statusFilter}`);
  }
  if (state.dateFrom || state.dateTo) {
    parts.push(`التاريخ: ${state.dateFrom || "البداية"} إلى ${state.dateTo || "النهاية"}`);
  }
  if (state.minPrice !== "" || state.maxPrice !== "") {
    const minStr = state.minPrice !== "" ? `${formatNumber(Number(state.minPrice))} YER` : "0";
    const maxStr = state.maxPrice !== "" ? `${formatNumber(Number(state.maxPrice))} YER` : "∞";
    parts.push(`السعر: ${minStr} – ${maxStr}`);
  }
  return parts.join(" | ");
}

function syncNavbarActiveState() {
  document.querySelectorAll("[data-nav-status]").forEach((link) => {
    const navStatus = link.getAttribute("data-nav-status");
    link.classList.toggle("active", navStatus === state.statusFilter);
  });
}

function openOrderModal(orderId) {
  const order = ordersData.find((item) => item.id === orderId);
  if (!order) return;

  const modal = document.getElementById("orderModal");
  const titleEl = document.getElementById("modalOrderTitle");
  const statusEl = document.getElementById("modalOrderStatus");
  const bodyEl = document.getElementById("modalBody");

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsSubtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);

  titleEl.textContent = `تفاصيل الطلب ${order.id}`;
  statusEl.className = `badge badge-${order.status}`;
  statusEl.textContent = order.status_ar || STATUS_LABELS[order.status] || order.status;

  bodyEl.innerHTML = `
    <div class="modal-meta-grid">
      <div class="modal-meta-item">
        <span class="modal-meta-label">اسم العميل</span>
        <span class="modal-meta-value">${order.customer}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">رقم الهاتف</span>
        <span class="modal-meta-value" dir="ltr">${order.phone}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">عنوان التوصيل</span>
        <span class="modal-meta-value">${order.address}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">تاريخ الطلب</span>
        <span class="modal-meta-value">${formatDate(order.created_at)}</span>
      </div>
    </div>

    <div>
      <div class="modal-section-title">الأصناف المطلوبة (${items.length})</div>
      <ul class="modal-items-list">
        ${items
          .map(
            (item) => `
          <li>
            <span>${item.name} &times; ${item.qty}</span>
            <strong>${formatNumber(Number(item.qty) * Number(item.price))} ${order.currency || "YER"}</strong>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>

    <div class="modal-summary-box">
      <div class="modal-summary-row">
        <span>قيمة الأصناف</span>
        <span>${formatNumber(itemsSubtotal)} ${order.currency || "YER"}</span>
      </div>
      <div class="modal-summary-row">
        <span>رسوم التوصيل</span>
        <span>${formatNumber(order.delivery_fee || 0)} ${order.currency || "YER"}</span>
      </div>
      <div class="modal-summary-total">
        <span>الإجمالي الكلي</span>
        <span>${formatNumber(order.total)} ${order.currency || "YER"}</span>
      </div>
    </div>
  `;

  modal.hidden = false;
}

function closeOrderModal() {
  document.getElementById("orderModal").hidden = true;
}

function syncStateUI() {
  const loadingEl = document.getElementById("loadingState");
  const errorEl = document.getElementById("errorState");
  const emptySourceEl = document.getElementById("emptySourceState");
  const errorDetailsEl = document.getElementById("errorDetails");
  const retryBtn = document.getElementById("retryBtn");
  const tableEl = document.getElementById("ordersTable");
  const paginationBar = document.getElementById("paginationBar");

  loadingEl.hidden = loadStatus !== "loading";
  errorEl.hidden = loadStatus !== "error";
  emptySourceEl.hidden = loadStatus !== "empty";

  const showTable = loadStatus === "success";
  tableEl.hidden = !showTable;
  paginationBar.hidden = !showTable;

  if (loadStatus === "error") {
    errorDetailsEl.textContent = lastErrorMessage || "تعذر قراءة ملف الطلبات المحلي.";
  }

  retryBtn.disabled = isRequestInFlight;
}

function render() {
  syncNavbarActiveState();

  // Update Column Headers Visibility
  document.querySelectorAll("thead th").forEach((th) => {
    const col = th.getAttribute("data-col");
    th.classList.toggle("col-hidden", !state.visibleCols[col]);
  });

  // Active Filter Badge
  const summary = buildFilterSummary();
  const badge = document.getElementById("activeFilterBadge");
  if (summary) {
    badge.style.display = "inline-flex";
    document.getElementById("activeFilterText").textContent = summary;
  } else {
    badge.style.display = "none";
  }

  syncStateUI();

  if (loadStatus !== "success") {
    return;
  }

  const filtered = getFilteredOrders();
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.rowsPerPage));

  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx = (state.currentPage - 1) * state.rowsPerPage;
  const endIdx = Math.min(startIdx + state.rowsPerPage, totalItems);
  const pageOrders = filtered.slice(startIdx, endIdx);

  const tbody = document.getElementById("ordersBody");
  tbody.innerHTML = "";

  if (pageOrders.length === 0) {
    const visibleCount = Object.values(state.visibleCols).filter(Boolean).length || 1;
    tbody.innerHTML = `<tr><td colspan="${visibleCount}" class="empty-state">لا توجد طلبات مطابقة لخيارات البحث أو التصفية.</td></tr>`;
  } else {
    pageOrders.forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      const tr = document.createElement("tr");
      tr.className = "data-row";
      tr.innerHTML = `
        <td data-col="id" class="${state.visibleCols.id ? "" : "col-hidden"}">
          <span class="order-id">${order.id}</span>
        </td>
        <td data-col="customer" class="${state.visibleCols.customer ? "" : "col-hidden"}">
          <div class="customer-name">${order.customer}</div>
          <div class="customer-phone">${order.phone}</div>
        </td>
        <td data-col="address" class="${state.visibleCols.address ? "" : "col-hidden"}">${order.address}</td>
        <td data-col="items" class="${state.visibleCols.items ? "" : "col-hidden"}">${items.length} أصناف (${totalQty} قطع)</td>
        <td data-col="status" class="${state.visibleCols.status ? "" : "col-hidden"}">
          <span class="badge badge-${order.status}">${order.status_ar}</span>
        </td>
        <td data-col="total" class="${state.visibleCols.total ? "" : "col-hidden"}">
          <div class="amount-main">${formatNumber(order.total)} ${order.currency}</div>
          <div class="amount-sub">شامل التوصيل (${formatNumber(order.delivery_fee)})</div>
        </td>
        <td data-col="created_at" class="${state.visibleCols.created_at ? "" : "col-hidden"}">${formatDate(order.created_at)}</td>
        <td data-col="actions" class="${state.visibleCols.actions ? "" : "col-hidden"}">
          <button type="button" class="btn-details" data-order-id="${order.id}">التفاصيل</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Pagination Info & Controls
  document.getElementById("showingInfo").textContent =
    totalItems === 0 ? "عرض 0 من 0" : `عرض ${startIdx + 1}–${endIdx} من ${totalItems}`;
  document.getElementById("currentPageBtn").textContent = state.currentPage;
  document.getElementById("pageInput").value = state.currentPage;
  document.getElementById("pageInput").max = totalPages;

  document.getElementById("firstPageBtn").disabled = state.currentPage <= 1;
  document.getElementById("prevPageBtn").disabled = state.currentPage <= 1;
  document.getElementById("nextPageBtn").disabled = state.currentPage >= totalPages;
  document.getElementById("lastPageBtn").disabled = state.currentPage >= totalPages;
}

// Delegated click for Details buttons inside tbody
document.getElementById("ordersBody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-details");
  if (!btn) return;
  const orderId = btn.getAttribute("data-order-id");
  openOrderModal(orderId);
});

// Modal close events
document.getElementById("closeModalBtn").addEventListener("click", closeOrderModal);
document.getElementById("orderModal").addEventListener("click", (e) => {
  if (e.target.id === "orderModal") {
    closeOrderModal();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("orderModal").hidden) {
    closeOrderModal();
  }
});

/**
 * Reusable JSON fetcher using Fetch API + async/await.
 * Guards against concurrent duplicate requests and handles HTTP, network, and JSON parse errors.
 */
async function fetchJsonData(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} (${response.statusText || "Request failed"})`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid JSON structure: expected an array of orders.");
  }
  return data;
}

async function loadOrders() {
  if (isRequestInFlight) {
    return;
  }

  isRequestInFlight = true;
  loadStatus = "loading";
  lastErrorMessage = "";
  render();

  try {
    const data = await fetchJsonData(ORDERS_JSON_URL);
    if (data.length === 0) {
      ordersData = [];
      loadStatus = "empty";
    } else {
      ordersData = data;
      loadStatus = "success";
    }
  } catch (err) {
    ordersData = [];
    loadStatus = "error";
    lastErrorMessage = err instanceof Error ? err.message : "Failed to load JSON data.";
  } finally {
    isRequestInFlight = false;
    render();
  }
}

// Retry Button
document.getElementById("retryBtn").addEventListener("click", () => {
  loadOrders();
});

// Navbar Status Quick Links
document.querySelectorAll("[data-nav-status]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const navStatus = link.getAttribute("data-nav-status");
    state.statusFilter = navStatus;
    document.getElementById("statusFilterSelect").value = navStatus;
    state.currentPage = 1;
    render();
  });
});

// Dropdown Toggles
const filterBtn = document.getElementById("filterBtn");
const filterMenu = document.getElementById("filterMenu");
const columnsBtn = document.getElementById("columnsBtn");
const columnsMenu = document.getElementById("columnsMenu");

filterBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  columnsMenu.classList.remove("open");
  filterMenu.classList.toggle("open");
});

columnsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  filterMenu.classList.remove("open");
  columnsMenu.classList.toggle("open");
});

document.addEventListener("click", () => {
  filterMenu.classList.remove("open");
  columnsMenu.classList.remove("open");
});

filterMenu.addEventListener("click", (e) => e.stopPropagation());
columnsMenu.addEventListener("click", (e) => e.stopPropagation());

// Status, Date & Price Filter Controls
const statusFilterSelect = document.getElementById("statusFilterSelect");
const dateFromInput = document.getElementById("dateFromInput");
const dateToInput = document.getElementById("dateToInput");
const minPriceInput = document.getElementById("minPriceInput");
const maxPriceInput = document.getElementById("maxPriceInput");

function clearAllFilters() {
  state.statusFilter = "all";
  state.dateFrom = "";
  state.dateTo = "";
  state.minPrice = "";
  state.maxPrice = "";
  statusFilterSelect.value = "all";
  dateFromInput.value = "";
  dateToInput.value = "";
  minPriceInput.value = "";
  maxPriceInput.value = "";
  state.currentPage = 1;
  render();
}

document.getElementById("applyFilterBtn").addEventListener("click", () => {
  state.statusFilter = statusFilterSelect.value;
  state.dateFrom = dateFromInput.value;
  state.dateTo = dateToInput.value;
  state.minPrice = minPriceInput.value;
  state.maxPrice = maxPriceInput.value;
  state.currentPage = 1;
  filterMenu.classList.remove("open");
  render();
});

document.getElementById("resetFilterBtn").addEventListener("click", () => {
  clearAllFilters();
  filterMenu.classList.remove("open");
});

document.getElementById("clearFilterBtn").addEventListener("click", clearAllFilters);

// Client Name Search Input
document.getElementById("searchInput").addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  state.currentPage = 1;
  render();
});

// Column Visibility Checkboxes
document.querySelectorAll("#columnsMenu input[type='checkbox']").forEach((cb) => {
  cb.addEventListener("change", () => {
    const col = cb.getAttribute("data-col");
    state.visibleCols[col] = cb.checked;
    render();
  });
});

// Pagination Events
document.getElementById("firstPageBtn").addEventListener("click", () => {
  state.currentPage = 1;
  render();
});

document.getElementById("prevPageBtn").addEventListener("click", () => {
  state.currentPage -= 1;
  render();
});

document.getElementById("nextPageBtn").addEventListener("click", () => {
  state.currentPage += 1;
  render();
});

document.getElementById("lastPageBtn").addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getFilteredOrders().length / state.rowsPerPage));
  state.currentPage = totalPages;
  render();
});

document.getElementById("pageInput").addEventListener("change", (e) => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val)) {
    state.currentPage = val;
    render();
  }
});

document.getElementById("rowsPerPage").addEventListener("change", (e) => {
  state.rowsPerPage = parseInt(e.target.value, 10);
  state.currentPage = 1;
  render();
});

// Initial Fetch on Page Load
loadOrders();
