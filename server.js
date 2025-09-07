const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Khởi tạo cache để lưu trữ dữ liệu lịch sử
const historicalDataCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// URL của API Sunwin gốc
const SUNWIN_API_URL = 'https://sicbosun-6esb.onrender.com/api/sicbosun';

// --- BẮT ĐẦU THUẬT TOÁN DỰ ĐOÁN MỚI ĐƯỢC DỊCH TỪ PYTHON SANG JAVASCRIPT ---

// Hàm dự đoán theo xí ngầu
function duDoanTheoXiNgau(diceList) {
    if (!diceList || diceList.length === 0) {
        return "Đợi thêm dữ liệu";
    }
    const [d1, d2, d3] = diceList.slice(-1)[0];
    const total = d1 + d2 + d3;
    const resultList = [];

    for (const d of [d1, d2, d3]) {
        let tmp = d + total;
        if (tmp in [4, 5]) {
            tmp -= 4;
        } else if (tmp >= 6) {
            tmp -= 6;
        }
        resultList.push(tmp % 2 === 0 ? "Tài" : "Xỉu");
    }

    const counts = {};
    resultList.forEach(item => {
        counts[item] = (counts[item] || 0) + 1;
    });

    return Object.keys(counts).reduce((a, b) => (counts[a] > counts[b]) ? a : b, "");
}

// Kiểm tra mẫu cầu xấu
function isCauXau(cauStr) {
    const mauCauXau = [
        "TXXTX", "TXTXT", "XXTXX", "XTXTX", "TTXTX",
        "XTTXT", "TXXTT", "TXTTX", "XXTTX", "XTXTT",
        "TXTXX", "XXTXT", "TTXXT", "TXTTT", "XTXTX",
        "XTXXT", "XTTTX", "TTXTT", "XTXTT", "TXXTX"
    ];
    return mauCauXau.includes(cauStr.toUpperCase());
}

// Kiểm tra mẫu cầu đẹp
function isCauDep(cauStr) {
    const mauCauDep = [
        "TTTTT", "XXXXX", "TTTXX", "XXTTT", "TXTXX",
        "TTTXT", "XTTTX", "TXXXT", "XXTXX", "TXTTT",
        "XTTTT", "TTXTX", "TXXTX", "TXTXT", "XTXTX",
        "TTTXT", "XTTXT", "TXTXT", "XXTXX", "TXXXX"
    ];
    return mauCauDep.includes(cauStr.toUpperCase());
}

// Hàm dự đoán chính, sử dụng logic của bạn
function predictTaiXiu(historicalData) {
    if (!historicalData || historicalData.length < 5) {
        return {
            du_doan: "Đang thu thập dữ liệu...",
            do_tin_cay: "Chưa đủ",
            giai_thich: "Cần ít nhất 5 phiên lịch sử để phân tích.",
            pattern: ""
        };
    }

    // Lấy 5 kết quả gần nhất để phân tích mẫu hình
    const patternHistory = historicalData.slice(-5).map(item => item.ket_qua === 'Tài' ? 'T' : 'X').join('');

    const predictionByDice = duDoanTheoXiNgau(historicalData.map(item => [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3]));
    let finalPrediction = predictionByDice;
    let doTinCay = "70%";
    let giaiThich = "Dự đoán dựa trên thuật toán phân tích xí ngầu.";

    if (isCauXau(patternHistory)) {
        finalPrediction = (finalPrediction === 'Tài') ? "Xỉu" : "Tài";
        giaiThich = `Cảnh báo: Phát hiện CẦU XẤU (${patternHistory}). Đảo ngược kết quả dự đoán.`;
        doTinCay = "65%";
    } else if (isCauDep(patternHistory)) {
        giaiThich = `Cầu đẹp (${patternHistory}). Giữ nguyên kết quả dự đoán.`;
        doTinCay = "85%";
    } else {
        giaiThich = `Không phát hiện mẫu cầu xấu/đẹp rõ ràng (${patternHistory}). Sử dụng kết quả dự đoán từ xí ngầu.`;
        doTinCay = "70%";
    }

    return {
        du_doan: finalPrediction,
        do_tin_cay: doTinCay,
        giai_thich: giaiThich,
        pattern: patternHistory
    };
}

// --- KẾT THÚC THUẬT TOÁN DỰ ĐOÁN ---

// Endpoint chính của API
app.get('/api/taixiu/du_doan_sunwin', async (req, res) => {
    let currentData = null;
    let historicalData = historicalDataCache.get("full_history") || [];

    try {
        const response = await axios.get(SUNWIN_API_URL);
        currentData = response.data;

        // Cập nhật lịch sử (chỉ thêm nếu là phiên mới)
        if (currentData && !historicalData.some(item => item.phien === currentData.phien)) {
            historicalData.push(currentData);
            const MAX_HISTORY_LENGTH = 100;
            if (historicalData.length > MAX_HISTORY_LENGTH) {
                historicalData = historicalData.slice(historicalData.length - MAX_HISTORY_LENGTH);
            }
            historicalDataCache.set("full_history", historicalData);
            console.log(`Đã thêm phiên ${currentData.phien} vào lịch sử. Tổng: ${historicalData.length}`);
        } else if (currentData) {
            console.log(`Phiên ${currentData.phien} đã có trong lịch sử.`);
        }

        const { du_doan, do_tin_cay, giai_thich, pattern } = predictTaiXiu(historicalData);

        const result = {
            phien_truoc: currentData ? currentData.phien : null,
            xuc_xac: currentData ? [currentData.xuc_xac_1, currentData.xuc_xac_2, currentData.xuc_xac_3] : [],
            tong_xuc_xac: currentData ? currentData.tong : null,
            ket_qua: currentData ? currentData.ket_qua : null,
            phien_sau: currentData ? currentData.phien + 1 : null,
            du_doan: du_doan,
            do_tin_cay: do_tin_cay,
            giai_thich: giai_thich,
            pattern: pattern
        };

        res.json(result);

    } catch (error) {
        console.error("Lỗi khi gọi API hoặc xử lý dữ liệu:", error.message);
        res.status(500).json({
            error: "Không thể lấy dữ liệu từ API gốc hoặc xử lý dự đoán.",
            details: error.message,
            du_doan: "Không thể dự đoán",
            do_tin_cay: "0%",
            giai_thich: "Lỗi hệ thống hoặc không đủ dữ liệu.",
            pattern: ""
        });
    }
});

// Endpoint mặc định
app.get('/', (req, res) => {
    res.send('Chào mừng đến với API dự đoán Tài Xỉu! Truy cập /api/taixiu/du_doan_sunwin để xem dự đoán.');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});