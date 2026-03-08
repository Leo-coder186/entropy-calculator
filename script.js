let globalResultText = "";

function parseLine(line) {
  line = line.trim();
  if (!line) return null;
  let items;
  if (line.includes(',')) {
    items = line.split(',').map(s => s.trim()).filter(s => s !== '');
  } else {
    items = line.split(/\s+/).filter(s => s !== '');
  }
  const nums = items.map(s => parseFloat(s));
  return nums.every(val => !isNaN(val)) ? nums : null;
}

function getEpsilon() {
  const input = document.getElementById('epsilonInput').value.trim();
  if (input === '') return 1e-6;
  let eps = Number(input);
  if (isNaN(eps) || eps <= 0) {
    alert(`❌ 平移常数 ε 必须是正数（例如：1e-6 或 0.000001）。\n已恢复为默认值 1e-6。`);
    document.getElementById('epsilonInput').value = '1e-6';
    return 1e-6;
  }
  if (eps > 0.01) {
    const msg = `⚠️ 注意：ε = ${eps} 较大，可能导致权重失真。\n通常建议 ε ≤ 0.001（1e-3）。\n是否继续？`;
    if (!confirm(msg)) return 1e-6;
  }
  return eps;
}

function calculateCVWeights(data) {
  const n = data.length;
  const m = data[0].length;
  const means = Array(m).fill(0);
  const stds = Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i][j];
    means[j] = sum / n;
  }
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      sumSq += Math.pow(data[i][j] - means[j], 2);
    }
    stds[j] = Math.sqrt(sumSq / (n - 1));
  }
  const cvs = [];
  for (let j = 0; j < m; j++) {
    cvs.push(stds[j] / Math.abs(means[j] || 1e-12));
  }
  const sumCV = cvs.reduce((a, b) => a + b, 0);
  return cvs.map(cv => cv / sumCV);
}

function dotProduct(a, b) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

// ✅ 使用你提供的博弈论公式（标准版）
function gameTheoryCombine(w1, w2) {
  if (!w1 || !w2) return null;
  const dot11 = dotProduct(w1, w1);
  const dot12 = dotProduct(w1, w2);
  const dot21 = dotProduct(w2, w1);
  const dot22 = dotProduct(w2, w2);
  const A = [[dot11, dot12], [dot21, dot22]];
  const b = [dot11, dot21]; // 根据你的公式：右边是 [W1·W1, W2·W1]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-12) {
    return w1.map((v, i) => (v + w2[i]) / 2);
  }
  const alpha1 = (b[0] * A[1][1] - b[1] * A[0][1]) / det;
  const alpha2 = (A[0][0] * b[1] - A[1][0] * b[0]) / det;
  const absAlpha1 = Math.abs(alpha1);
  const absAlpha2 = Math.abs(alpha2);
  const sumAbs = absAlpha1 + absAlpha2;
  if (sumAbs < 1e-12) return null;
  const a1 = absAlpha1 / sumAbs;
  const a2 = absAlpha2 / sumAbs;
  return w1.map((v, i) => a1 * v + a2 * w2[i]);
}

function formatEntropyWeights(e, d, weights) {
  let text = "指标\t熵值(e)\t\t差异系数(1-e)\t熵权(w)\n";
  text += "─".repeat(55) + "\n";
  for (let j = 0; j < e.length; j++) {
    text += `X${j + 1}\t${e[j].toFixed(6)}\t\t${d[j].toFixed(6)}\t\t${weights[j].toFixed(6)}\n`;
  }
  return text;
}

function calculateWeights() {
  const input = document.getElementById("dataInput").value.trim();
  if (!input) {
    alert("⚠️ 请输入数据！");
    return;
  }
  const lines = input.split(/\r?\n/);
  const rawData = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (parsed) rawData.push(parsed);
  }
  if (rawData.length === 0) {
    showResult("❌ 未识别到有效数值。\n请确保每行包含数字，并用逗号或空格分隔。", true);
    return;
  }
  const n = rawData.length;
  const m = rawData[0].length;
  if (n < 2 || m < 2) {
    showResult("❌ 至少需要 2 行 × 2 列数据。", true);
    return;
  }
  for (let i = 1; i < rawData.length; i++) {
    if (rawData[i].length !== m) {
      showResult(`❌ 第 ${i + 1} 行有 ${rawData[i].length} 个数值，但应为 ${m} 个。`, true);
      return;
    }
  }
  const EPS = getEpsilon();
  const shifted = Array(n).fill().map(() => Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    const colMin = Math.min(...rawData.map(row => row[j]));
    for (let i = 0; i < n; i++) {
      shifted[i][j] = rawData[i][j] - colMin + EPS;
    }
  }
  let resultText = `✅ 成功处理 ${n} 个样本，${m} 个指标\n`;
  resultText += `💡 使用平移常数 ε = ${EPS.toExponential(2)}\n\n`;
  const weightsList = [];
  if (document.getElementById('methodEntropy').checked) {
    const normalized = Array(n).fill().map(() => Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const sum = shifted.reduce((acc, row) => acc + row[j], 0);
      for (let i = 0; i < n; i++) {
        normalized[i][j] = shifted[i][j] / sum;
      }
    }
    const e = Array(m).fill(0);
    const lnN = Math.log(n);
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const p = normalized[i][j];
        if (p > 0) sum += p * Math.log(p);
      }
      e[j] = -sum / lnN;
    }
    const d = e.map(v => 1 - v);
    const sumD = d.reduce((a, b) => a + b, 0);
    const weights = sumD === 0 ? d.map(() => 0) : d.map(v => v / sumD);
    resultText += "【熵权法】\n";
    resultText += formatEntropyWeights(e, d, weights);
    weightsList.push({ name: '熵权', w: weights });
  }
  if (document.getElementById('methodCV').checked) {
    const cvWeights = calculateCVWeights(shifted);
    resultText += "\n【变异系数法】\n";
    resultText += "指标\tCV值\t\t权重\n";
    resultText += "─".repeat(40) + "\n";
    const means = Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += shifted[i][j];
      means[j] = sum / n;
    }
    for (let j = 0; j < m; j++) {
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        sumSq += Math.pow(shifted[i][j] - means[j], 2);
      }
      const std = Math.sqrt(sumSq / (n - 1));
      const cv = std / Math.abs(means[j] || 1e-12);
      resultText += `X${j+1}\t${cv.toFixed(6)}\t\t${cvWeights[j].toFixed(6)}\n`;
    }
    weightsList.push({ name: 'CV', w: cvWeights });
  }
  if (document.getElementById('methodGame').checked && weightsList.length >= 2) {
    const w1 = weightsList[0].w;
    const w2 = weightsList[1].w;
    const gameWeight = gameTheoryCombine(w1, w2);
    if (gameWeight) {
      resultText += "\n【博弈论综合赋权】\n";
      resultText += "指标\t综合权重\n";
      resultText += "─".repeat(25) + "\n";
      for (let j = 0; j < m; j++) {
        resultText += `X${j+1}\t${gameWeight[j].toFixed(6)}\n`;
      }
    }
  }
  globalResultText = resultText;
  showResult(resultText, false);
  document.getElementById("exportBtn").style.display = "flex";
}

function showResult(text, isError) {
  const container = document.getElementById("result-container");
  const resultDiv = document.getElementById("result");
  resultDiv.textContent = text;
  resultDiv.className = isError ? "error" : "";
  container.classList.remove("show");
  setTimeout(() => container.classList.add("show"), 10);
}

function exportResult() {
  if (!globalResultText) {
    alert("请先计算权重！");
    return;
  }
  const blob = new Blob([globalResultText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'comprehensive_weights_result.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}