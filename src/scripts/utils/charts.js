import { SIZES } from "../constants.js";

export function clearCanvas(canvasEl) {
  if (!canvasEl) {
    return;
  }
  const ctx = canvasEl.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function prepareCanvas(canvasEl) {
  if (!canvasEl) {
    return null;
  }
  const displayWidth = canvasEl.clientWidth || canvasEl.width || 0;
  const displayHeight = canvasEl.clientHeight || canvasEl.height || 0;
  if (!displayWidth || !displayHeight) {
    return null;
  }
  const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const width = Math.max(1, Math.round(displayWidth * dpr));
  const height = Math.max(1, Math.round(displayHeight * dpr));
  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
  }
  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    return null;
  }
  if (typeof ctx.resetTransform === "function") {
    ctx.resetTransform();
  }
  ctx.scale(dpr, dpr);
  return {
    ctx,
    width: displayWidth || canvasEl.width,
    height: displayHeight || canvasEl.height
  };
}

export function drawHistogram(
  canvasEl,
  counts,
  { percentages = [], yLabel = "units", colors, barRadius = 12, labels = SIZES } = {}
) {
  if (!canvasEl || !Array.isArray(counts) || counts.length === 0) {
    return;
  }
  const prepared = prepareCanvas(canvasEl);
  if (!prepared) {
    return;
  }
  const { ctx, width, height } = prepared;

  ctx.clearRect(0, 0, width, height);

  const margin = { top: 36, right: 40, bottom: 70, left: 72 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const originX = margin.left;
  const originY = height - margin.bottom;
  const maxValue = Math.max(...counts, 0);
  const scaleMax = maxValue > 0 ? maxValue : 1;
  const barSpacing = counts.length ? chartWidth / counts.length : 0;
  const barWidth = barSpacing * 0.62;

  ctx.strokeStyle = "rgba(149, 171, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(originX, margin.top - 8);
  ctx.lineTo(originX, originY);
  ctx.lineTo(width - margin.right + 10, originY);
  ctx.stroke();

  ctx.font = "13px 'Inter', 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(218, 225, 255, 0.88)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const tickCount = 5;
  ctx.setLineDash([5, 8]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(90, 113, 188, 0.22)";
  for (let i = 0; i <= tickCount; i += 1) {
    const value = (scaleMax / tickCount) * i;
    const y = originY - (value / scaleMax) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} ${yLabel}`, originX - 12, y);
  }
  ctx.setLineDash([]);

  counts.forEach((count, index) => {
    const barHeight = scaleMax > 0 ? (count / scaleMax) * chartHeight : 0;
    const x = originX + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = originY - barHeight;

    if (barHeight > 0) {
      const gradient = ctx.createLinearGradient(x, y, x, originY);
      const topColor = colors && colors.from ? colors.from : "rgba(111, 136, 255, 0.95)";
      const bottomColor = colors && colors.to ? colors.to : "rgba(73, 94, 201, 0.82)";
      gradient.addColorStop(0, topColor);
      gradient.addColorStop(1, bottomColor);
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x, y, barWidth, barHeight, barRadius);
    }

    const percent = percentages[index] || 0;
    const roundedCount = Number.isFinite(count) ? Math.round(count) : 0;
    const labelParts = [roundedCount.toLocaleString()];
    if (percent > 0) {
      labelParts.push(`(${(percent * 100).toFixed(1)}%)`);
    }
    const label = labelParts.join(" ");

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px 'Inter', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    if (barHeight > 0) {
      ctx.fillText(label, x + barWidth / 2, y - 10);
    } else {
      ctx.fillText("0", x + barWidth / 2, originY - 10);
    }

    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(182, 196, 255, 0.85)";
    ctx.save();
    ctx.translate(x, originY + 18);
    ctx.rotate(-Math.PI / 18);
    const axisLabel = labels[index] || labels[labels.length - 1] || "";
    ctx.fillText(axisLabel, 0, 0);
    ctx.restore();
  });
}
