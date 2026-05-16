const CLIPBOARD_PAYLOAD_SOURCE = "thankfulforyou-etsy-clipboard";

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

function buildClipboardItems() {
  const orders = getOrdersCollection();

  return orders.flatMap((order) => {
    const buyerName = order?.fulfillment?.to_address?.name || "";
    let itemNumber = 0;

    return (order?.transactions || []).flatMap((transaction) => {
      const personalizationEntries = getPersonalizationEntries(transaction);
      return personalizationEntries.map((personalizationEntry) => {
        itemNumber += 1;
        return {
          orderNumber: String(order.order_id),
          listingId: String(transaction.listing_id),
          transactionId: String(transaction.transaction_id),
          buyerName,
          colorName: getVariationValue(transaction, "Color"),
          quantity: getTransactionQuantity(transaction),
          listingTitle: transaction?.product?.title || "",
          listingImageUrl75x75: transaction?.product?.image_url_75x75 || "",
          label: `#${order.order_id}${buyerName ? ` · ${buyerName}` : ""}${itemNumber > 1 ? ` · Item ${itemNumber}` : ""}`,
          personalization: personalizationEntry.value,
        };
      });
    });
  });
}

async function copyBadgeQueuePayload() {
  const items = buildClipboardItems();

  if (!items.length) {
    console.warn("No personalized Etsy line items found on this page.");
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
}

function ensureCopyButton() {
  if (document.querySelector("[data-badge-clipboard-copy]")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.badgeClipboardCopy = "true";
  button.textContent = "Copy Badge Queue";
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
      await copyBadgeQueuePayload();
      button.textContent = "Copied";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1200);
    } catch (error) {
      console.error("Failed to copy badge queue payload.", error);
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

  document.body.append(button);
}

ensureCopyButton();
