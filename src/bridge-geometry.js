export function maskHasInk(mask, x, y) {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }

  if (mask.data) {
    return mask.data[(y * mask.width + x) * 4 + 3] > 32;
  }

  const row = mask.opaqueRows?.[y];
  return Array.isArray(row) && row.includes(x);
}

export function getOverlapBridgeLengthPx(leftMask, rightMask, dxPx) {
  const baselineDelta = leftMask.baseline - rightMask.baseline;
  const overlapPixels = new Set();

  for (let rightY = 0; rightY < rightMask.height; rightY += 1) {
    const row = rightMask.opaqueRows?.[rightY];
    if (!row) {
      continue;
    }

    const leftY = rightY + baselineDelta;
    if (leftY < 0 || leftY >= leftMask.height) {
      continue;
    }

    for (const rightX of row) {
      const leftX = rightX + dxPx;
      if (maskHasInk(leftMask, leftX, leftY)) {
        overlapPixels.add(`${leftX},${leftY}`);
      }
    }
  }

  let longestBridge = 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (overlapPixels.size) {
    const [start] = overlapPixels;
    overlapPixels.delete(start);

    const frontier = [start];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    while (frontier.length) {
      const key = frontier.pop();
      const [x, y] = key.split(",").map(Number);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (const [dx, dy] of neighbors) {
        const neighborKey = `${x + dx},${y + dy}`;
        if (!overlapPixels.has(neighborKey)) {
          continue;
        }

        overlapPixels.delete(neighborKey);
        frontier.push(neighborKey);
      }
    }

    longestBridge = Math.max(longestBridge, maxX - minX + 1, maxY - minY + 1);
  }

  return longestBridge;
}

export function findPairOffsetPx(leftMask, rightMask, targetPx) {
  const start = leftMask.width + rightMask.width;
  const end = -rightMask.width;

  for (let dx = start; dx >= end; dx -= 1) {
    if (getOverlapBridgeLengthPx(leftMask, rightMask, dx) >= targetPx) {
      return dx;
    }
  }

  return null;
}
