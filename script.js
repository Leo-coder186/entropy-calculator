// 全局变量：用于保存最终计算结果文本，供“导出结果”功能使用
let globalResultText = "";

/**
 * 解析单行输入数据（支持逗号或空格分隔）
 * @param {string} line - 用户在 textarea 中输入的一行文本
 * @returns {number[] | null} 
 *   - 若解析成功，返回数字数组（如 [1.2, 3.4, 5]）
 *   - 若该行为注释、空行或含非数字字符，返回 null
 */
function parseLine(line) {
  // 去除行首尾空白字符
  line = line.trim();
  
  // 如果是空行，直接跳过
  if (!line) return null;

  let items;
  // 判断是否包含逗号 → 按逗号分割（兼容 Excel 复制粘贴）
  if (line.includes(',')) {
    // 按逗号分割后，对每个元素去空格，并过滤掉空字符串
    items = line.split(',').map(s => s.trim()).filter(s => s !== '');
  } else {
    // 否则按一个或多个空白符（空格、Tab）分割
    items = line.split(/\s+/).filter(s => s !== '');
  }

  // 尝试将每个字符串转换为浮点数
  const nums = items.map(s => parseFloat(s));
  
  // 检查所有转换结果是否都是有效数字（非 NaN）
  // 若全部有效，返回数字数组；否则视为无效行，返回 null
  return nums.every(val => !isNaN(val)) ? nums : null;
}

/**
 * 获取用户自定义的平移常数 ε（epsilon）
 * 作用：避免原始数据中出现 0 或负值，导致 ln(0) 或归一化失败
 * @returns {number} 返回正数 ε，若输入非法则使用默认值 1e-6
 */
function getEpsilon() {
  // 从页面 input 元素获取用户输入值，并去除首尾空格
  const input = document.getElementById('epsilonInput').value.trim();
  
  // 若用户未输入，则使用默认值 1e-6（科学计数法表示 0.000001）
  if (input === '') return 1e-6;

  // 尝试将输入转为数字
  let eps = Number(input);
  
  // 校验：ε 必须是正数
  if (isNaN(eps) || eps <= 0) {
    // 弹出警告框提示用户
    alert(`❌ 平移常数 ε 必须是正数（例如：1e-6 或 0.000001）。\n已恢复为默认值 1e-6。`);
    // 自动修正输入框内容为默认值
    document.getElementById('epsilonInput').value = '1e-6';
    return 1e-6;
  }

  // 警告：如果 ε 过大（>0.01），可能严重影响权重准确性
  if (eps > 0.01) {
    const msg = `⚠️ 注意：ε = ${eps} 较大，可能导致权重失真。\n通常建议 ε ≤ 0.001（1e-3）。\n是否继续？`;
    // 弹出确认框，用户可选择取消并回退到默认值
    if (!confirm(msg)) return 1e-6;
  }
  // 返回合法的 ε 值
  return eps;
}

/**
 * 使用变异系数法（Coefficient of Variation, CV）计算权重
 * CV = 标准差 / 均值，反映指标的离散程度；CV 越大，信息量越大，权重越高
 * @param {number[][]} data - 已经过平移处理的正数数据矩阵（n 行样本 × m 列指标）
 * @returns {number[]} - 归一化后的 CV 权重向量，长度为 m
 */
function calculateCVWeights(data) {
  const n = data.length;      // 样本数量（行数）
  const m = data[0].length;   // 指标数量（列数）

  // 步骤1：计算每列（每个指标）的均值
  const means = Array(m).fill(0); // 初始化均值数组
  for (let j = 0; j < m; j++) {   // 遍历每一列
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i][j]; // 累加该列所有样本值
    means[j] = sum / n; // 计算均值
  }

  // 步骤2：计算每列的标准差（使用样本标准差公式，分母为 n-1）
  const stds = Array(m).fill(0); // 初始化标准差数组
  for (let j = 0; j < m; j++) {
    let sumSq = 0; // 平方和
    for (let i = 0; i < n; i++) {
      // 计算 (x_ij - mean_j)^2
      sumSq += Math.pow(data[i][j] - means[j], 2);
    }
    // 样本标准差 = sqrt( Σ(x - mean)^2 / (n - 1) )
    stds[j] = Math.sqrt(sumSq / (n - 1));
  }

  // 步骤3：计算变异系数 CV = std / |mean|（取绝对值防止除零）
  const cvs = [];
  for (let j = 0; j < m; j++) {
    // 防止均值为 0 导致除零错误，用极小值 1e-12 替代
    cvs.push(stds[j] / Math.abs(means[j] || 1e-12));
  }

  // 步骤4：归一化 CV 值，使其总和为 1 → 得到权重
  const sumCV = cvs.reduce((a, b) => a + b, 0); // 计算 CV 总和
  // 对每个 CV 值除以总和，得到最终权重
  return cvs.map(cv => cv / sumCV);
}

/**
 * 计算两个向量的点积（内积）：a · b = Σ(a_i * b_i)
 * @param {number[]} a - 向量 a（长度 n）
 * @param {number[]} b - 向量 b（长度 n，需与 a 等长）
 * @returns {number} - 点积结果（标量）
 */
function dotProduct(a, b) {
  // 使用 reduce 遍历数组，累加对应元素乘积
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * 博弈论综合赋权方法：融合两种独立权重向量（如熵权 w1 和 CV 权 w2）
 * 核心思想：寻找最优组合系数 α1, α2，使综合权重与各方法权重的总体偏差最小
 * 数学形式：解线性方程组 A * α = b，其中 A 是 Gram 矩阵
 * @param {number[]} w1 - 第一种方法的权重向量（长度 m）
 * @param {number[]} w2 - 第二种方法的权重向量（长度 m）
 * @returns {number[] | null} - 综合权重向量（长度 m），若失败返回 null
 */
function gameTheoryCombine(w1, w2) {
  // 安全检查：确保两个权重向量都存在
  if (!w1 || !w2) return null;

  // 构建 2x2 Gram 矩阵 A：
  // A[0][0] = w1 · w1, A[0][1] = w1 · w2
  // A[1][0] = w2 · w1, A[1][1] = w2 · w2
  const dot11 = dotProduct(w1, w1);
  const dot12 = dotProduct(w1, w2);
  const dot21 = dotProduct(w2, w1); // 实际等于 dot12（对称）
  const dot22 = dotProduct(w2, w2);

  const A = [[dot11, dot12], [dot21, dot22]];

  // 构造右侧向量 b = [w1·w1, w2·w1]^T
  // （根据博弈论优化目标推导得出）
  const b = [dot11, dot21];

  // 计算矩阵 A 的行列式 det(A) = a11*a22 - a12*a21
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];

  // 若行列式接近 0，说明矩阵奇异（两权重高度相关），无法求逆
  if (Math.abs(det) < 1e-12) {
    // 退化策略：直接取算术平均作为综合权重
    return w1.map((v, i) => (v + w2[i]) / 2);
  }

  // 使用克莱姆法则（Cramer's Rule）求解线性方程组
  const alpha1 = (b[0] * A[1][1] - b[1] * A[0][1]) / det;
  const alpha2 = (A[0][0] * b[1] - A[1][0] * b[0]) / det;

  // 取系数的绝对值（确保权重非负），并归一化
  const absAlpha1 = Math.abs(alpha1);
  const absAlpha2 = Math.abs(alpha2);
  const sumAbs = absAlpha1 + absAlpha2;

  // 防止归一化时除零
  if (sumAbs < 1e-12) return null;

  // 归一化系数
  const a1 = absAlpha1 / sumAbs;
  const a2 = absAlpha2 / sumAbs;

  // 计算综合权重：w_combined = a1 * w1 + a2 * w2
  return w1.map((v, i) => a1 * v + a2 * w2[i]);
}

/**
 * 格式化熵权法计算结果，生成表格形式的文本
 * @param {number[]} e - 熵值数组（长度 m）
 * @param {number[]} d - 差异系数数组（d_j = 1 - e_j）
 * @param {number[]} weights - 熵权数组
 * @returns {string} - 格式化后的多行文本
 */
function formatEntropyWeights(e, d, weights) {
  // 表头
  let text = "指标\t熵值(e)\t\t差异系数(1-e)\t熵权(w)\n";
  // 分隔线（55个短横线）
  text += "─".repeat(55) + "\n";
  // 遍历每个指标，输出一行数据
  for (let j = 0; j < e.length; j++) {
    // X1, X2, ... 表示第 j+1 个指标
    // 保留 6 位小数，对齐显示
    text += `X${j + 1}\t${e[j].toFixed(6)}\t\t${d[j].toFixed(6)}\t\t${weights[j].toFixed(6)}\n`;
  }
  return text;
}

/**
 * 主计算函数：触发整个权重计算流程
 * 包括：数据解析 → 平移处理 → 多方法权重计算 → 结果展示
 */
function calculateWeights() {
  // 获取用户在 textarea 中输入的原始数据
  const input = document.getElementById("dataInput").value.trim();
  // 若为空，提示用户
  if (!input) {
    alert("⚠️ 请输入数据！");
    return;
  }

  // 按换行符分割成多行（兼容 Windows \r\n 和 Unix \n）
  const lines = input.split(/\r?\n/);
  const rawData = []; // 存储解析后的二维数组

  // 逐行解析
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]); // 调用解析函数
    if (parsed) rawData.push(parsed);   // 仅保留有效行
  }

  // ========== 数据校验 ==========
  // 若无有效数据
  if (rawData.length === 0) {
    showResult("❌ 未识别到有效数值。\n请确保每行包含数字，并用逗号或空格分隔。", true);
    return;
  }
  const n = rawData.length;  // 样本数
  const m = rawData[0].length; // 指标数

  // 至少需要 2x2 数据（否则无法计算标准差或熵）
  if (n < 2 || m < 2) {
    showResult("❌ 至少需要 2 行 × 2 列数据。", true);
    return;
  }

  // 检查每行数据列数是否一致
  for (let i = 1; i < rawData.length; i++) {
    if (rawData[i].length !== m) {
      showResult(`❌ 第 ${i + 1} 行有 ${rawData[i].length} 个数值，但应为 ${m} 个。`, true);
      return;
    }
  }

  // ========== 数据平移处理 ==========
  // 获取用户设定的 ε
  const EPS = getEpsilon();
  // 创建新矩阵 shifted，用于存储平移后的正数数据
  const shifted = Array(n).fill().map(() => Array(m).fill(0));
  // 对每一列独立处理：减去该列最小值，再加 ε → 保证所有值 > 0
  for (let j = 0; j < m; j++) {
    const colMin = Math.min(...rawData.map(row => row[j])); // 找到该列最小值
    for (let i = 0; i < n; i++) {
      shifted[i][j] = rawData[i][j] - colMin + EPS;
    }
  }

  // ========== 开始构建结果文本 ==========
  let resultText = `✅ 成功处理 ${n} 个样本，${m} 个指标\n`;
  resultText += `💡 使用平移常数 ε = ${EPS.toExponential(2)}\n\n`;

  const weightsList = []; // 用于存储各方法的权重，供后续融合使用

  // ========== 熵权法计算 ==========
  if (document.getElementById('methodEntropy').checked) {
    // 步骤1：列归一化 p_ij = x_ij / Σ_i x_ij
    const normalized = Array(n).fill().map(() => Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const sum = shifted.reduce((acc, row) => acc + row[j], 0); // 计算列和
      for (let i = 0; i < n; i++) {
        normalized[i][j] = shifted[i][j] / sum;
      }
    }

    // 步骤2：计算熵值 e_j = - (1/ln(n)) * Σ_i (p_ij * ln(p_ij))
    const e = Array(m).fill(0);
    const lnN = Math.log(n); // 预计算 ln(n)
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const p = normalized[i][j];
        // 仅当 p > 0 时才计算 ln(p)，避免 ln(0)
        if (p > 0) sum += p * Math.log(p);
      }
      e[j] = -sum / lnN; // 熵值范围 [0, 1]
    }

    // 步骤3：计算差异系数 d_j = 1 - e_j（e 越小，d 越大，信息量越大）
    const d = e.map(v => 1 - v);
    // 步骤4：归一化差异系数得到熵权
    const sumD = d.reduce((a, b) => a + b, 0);
    const weights = sumD === 0 ? d.map(() => 0) : d.map(v => v / sumD);

    // 格式化输出
    resultText += "【熵权法】\n";
    resultText += formatEntropyWeights(e, d, weights);
    // 保存权重供后续融合
    weightsList.push({ name: '熵权', w: weights });
  }

  // ========== 变异系数法计算 ==========
  if (document.getElementById('methodCV').checked) {
    // 调用 CV 权重计算函数
    const cvWeights = calculateCVWeights(shifted);
    // 构建输出文本
    resultText += "\n【变异系数法】\n";
    resultText += "指标\tCV值\t\t权重\n";
    resultText += "─".repeat(40) + "\n";

    // 重新计算均值和标准差用于显示（复用部分逻辑）
    const means = Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += shifted[i][j];
      means[j] = sum / n;
    }

    // 输出每行指标的 CV 和权重
    for (let j = 0; j < m; j++) {
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        sumSq += Math.pow(shifted[i][j] - means[j], 2);
      }
      const std = Math.sqrt(sumSq / (n - 1));
      const cv = std / Math.abs(means[j] || 1e-12);
      resultText += `X${j+1}\t${cv.toFixed(6)}\t\t${cvWeights[j].toFixed(6)}\n`;
    }
    // 保存权重
    weightsList.push({ name: 'CV', w: cvWeights });
  }

  // ========== 博弈论综合赋权 ==========
  if (document.getElementById('methodGame').checked && weightsList.length >= 2) {
    // 取前两种方法的权重进行融合
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

  // ========== 显示结果 ==========
  globalResultText = resultText; // 保存全局
  showResult(resultText, false); // 在页面显示
  // 显示“导出结果”按钮
  document.getElementById("exportBtn").style.display = "flex";
}

/**
 * 在页面上动态显示计算结果（带动画效果）
 * @param {string} text - 要显示的文本内容
 * @param {boolean} isError - 是否为错误信息（决定样式）
 */
function showResult(text, isError) {
  const container = document.getElementById("result-container");
  const resultDiv = document.getElementById("result");
  // 设置文本内容
  resultDiv.textContent = text;
  // 根据是否错误设置 CSS 类（红色文字等）
  resultDiv.className = isError ? "error" : "";
  // 触发动画：先移除 show 类（隐藏），再添加（淡入）
  container.classList.remove("show");
  setTimeout(() => container.classList.add("show"), 10);
}

/**
 * 将计算结果导出为 .txt 文件
 */
function exportResult() {
  // 安全检查：确保已有结果
  if (!globalResultText) {
    alert("请先计算权重！");
    return;
  }
  // 创建 Blob 对象（文本文件内容）
  const blob = new Blob([globalResultText], { type: 'text/plain;charset=utf-8' });
  // 生成临时 URL
  const url = URL.createObjectURL(blob);
  // 创建隐藏的 <a> 标签用于下载
  const a = document.createElement('a');
  a.href = url;
  a.download = 'comprehensive_weights_result.txt'; // 默认文件名
  document.body.appendChild(a);
  a.click(); // 触发下载
  document.body.removeChild(a); // 清理 DOM
  URL.revokeObjectURL(url); // 释放内存
}