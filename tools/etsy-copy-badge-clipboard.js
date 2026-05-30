const CLIPBOARD_PAYLOAD_SOURCE = "thankfulforyou-etsy-clipboard";
const ITEM_LABEL_SEPARATOR = " · ";

function getOrdersCollection() {
  return window.Etsy?.Context?.data?.initial_data?.orders?.orders_search?.orders || [];
}

function getPersonalizationEntries(transaction) {
  if (!Array.isArray(transaction?.variations)) {
    return [];
  }

  return transaction.variations.filter((variation) => {
    return variation?.property === "Personalization" && typeof variation?.value === "string" && variation.value.trim();
  });
}

function getVariationValue(transaction, propertyName) {
  if (!Array.isArray(transaction?.variations)) {
    return "";
  }

  const variation = transaction.variations.find((entry) => {
    return entry?.property === propertyName && typeof entry?.value === "string" && entry.value.trim();
  });

  return variation?.value || "";
}

function getTransactionQuantity(transaction) {
  const quantity = transaction?.quantity;
  if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
    return String(quantity);
  }

  if (typeof quantity === "string" && quantity.trim()) {
    return quantity.trim();
  }

  return "1";
}

function buildSkippedTransactionEntry(order, transaction, reason) {
  return {
    orderNumber: String(order?.order_id ?? ""),
    buyerName: order?.fulfillment?.to_address?.name || "",
    transactionId: String(transaction?.transaction_id ?? ""),
    listingId: String(transaction?.listing_id ?? ""),
    listingTitle: transaction?.product?.title || "",
    reason,
  };
}

function buildOrderItemLabel(orderId, buyerName, itemNumber) {
  let label = `#${orderId}`;

  if (buyerName) {
    label += `${ITEM_LABEL_SEPARATOR}${buyerName}`;
  }

  if (itemNumber > 1) {
    label += `${ITEM_LABEL_SEPARATOR}Item ${itemNumber}`;
  }

  return label;
}

function analyzeOrdersForClipboard() {
  const orders = getOrdersCollection();
  const items = [];
  const skipped = [];

  orders.forEach((order) => {
    const buyerName = order?.fulfillment?.to_address?.name || "";
    let itemNumber = 0;

    (order?.transactions || []).forEach((transaction) => {
      const personalizationEntries = getPersonalizationEntries(transaction);
      if (!personalizationEntries.length) {
        skipped.push(buildSkippedTransactionEntry(order, transaction, "Missing Personalization variation"));
        return;
      }

      personalizationEntries.forEach((personalizationEntry) => {
        itemNumber += 1;
        items.push({
          orderNumber: String(order.order_id),
          listingId: String(transaction.listing_id),
          transactionId: String(transaction.transaction_id),
          buyerName,
          colorName: getVariationValue(transaction, "Color"),
          quantity: getTransactionQuantity(transaction),
          listingTitle: transaction?.product?.title || "",
          listingImageUrl75x75: transaction?.product?.image_url_75x75 || "",
          label: buildOrderItemLabel(order.order_id, buyerName, itemNumber),
          personalization: personalizationEntry.value,
        });
      });
    });
  });

  return {
    items,
    skipped,
    totalOrders: orders.length,
  };
}

function buildClipboardItems() {
  return analyzeOrdersForClipboard().items;
}

async function copyBadgeBatchPayload() {
  const { items, skipped, totalOrders } = analyzeOrdersForClipboard();

  if (!items.length) {
    console.warn("No personalized Etsy line items found on this page.", skipped);
    return;
  }

  const payload = JSON.stringify({
    source: CLIPBOARD_PAYLOAD_SOURCE,
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
  }, null, 2);

  await navigator.clipboard.writeText(payload);
  console.info(`Copied ${items.length} Etsy design items to the clipboard.`);

  if (skipped.length) {
    console.warn(`Skipped ${skipped.length} Etsy order(s) while building the badge batch.`, skipped);
    return;
  }

  if (totalOrders > items.length) {
    console.warn(`Copied ${items.length} Etsy design items from ${totalOrders} order(s).`);
  }
}

function ensureCopyButton() {
  if (document.querySelector("[data-badge-clipboard-copy]")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.badgeClipboardCopy = "true";
  button.textContent = "Copy Badge Batch";
  button.style.position = "fixed";
  button.style.right = "16px";
  button.style.bottom = "92px";
  button.style.zIndex = "99999";
  button.style.padding = "10px 14px";
  button.style.border = "1px solid #0b7a75";
  button.style.borderRadius = "8px";
  button.style.background = "#ffffff";
  button.style.color = "#0b7a75";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 12px 26px rgba(0, 0, 0, 0.12)";
  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Copying...";

    try {
      await copyBadgeBatchPayload();
      button.textContent = "Copied";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1200);
    } catch (error) {
      console.error("Failed to copy badge batch payload.", error);
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

  document.body.append(button);
}

ensureCopyButton();
