const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Cache
const dataCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// API gốc
const SUNWIN_API_URL = 'https://sicbosun-6esb.onrender.com/api/sicbosun';

// Quản lý lịch sử
class HistoricalDataManager {
    constructor(maxHistoryLength = 500) {
        this.history = [];
        this.maxHistoryLength = maxHistoryLength;
    }

    addSession(newData) {
        if (!newData || !newData.phien) return false;
        if (this.history.some(item => item.phien === newData.phien)) return false;
        this.history.push(newData);
        if (this.history.length > this.maxHistoryLength) {
            this.history = this.history.slice(this.history.length - this.maxHistoryLength);
        }
        this.history.sort((a, b) => a.phien - b.phien);
        return true;
    }

    getHistory() {
        return [...this.history];
    }

    getRecentHistory(count) {
        return this.history.slice(-count);
    }

    calculateFrequency(dataSubset) {
        let taiCount = 0, xiuCount = 0;
        if (!dataSubset || dataSubset.length === 0) {
            return { taiCount: 0, xiuCount: 0, totalCount: 0, taiRatio: 0, xiuRatio: 0 };
        }
        dataSubset.forEach(item => {
            if (item.ket_qua === 'Tài') taiCount++;
            else if (item.ket_qua === 'Xỉu') xiuCount++;
        });
        const totalCount = dataSubset.length;
        return {
            taiCount,
            xiuCount,
            totalCount,
            taiRatio: totalCount > 0 ? taiCount / totalCount : 0,
            xiuRatio: totalCount > 0 ? xiuCount / totalCount : 0
        };
    }

    calculateCurrentSequence(dataSubset, resultType) {
        if (!dataSubset || dataSubset.length === 0) return 0;
        let count = 0;
        for (let i = dataSubset.length - 1; i >= 0; i--) {
            if (dataSubset[i].ket_qua === resultType) count++;
            else break;
        }
        return count;
    }
}

// Engine dự đoán
class PredictionEngine {
    constructor(historyMgr) {
        this.historyMgr = historyMgr;
        this.baseWeights = {
            bet: 5.0,
            dao11: 4.5,
            dao22: 4.0,
            dao33: 3.8,
            tyLeApDao: 3.0,
            mauLapLai: 3.5,
            uuTienGanDay: 3.2,
            default: 1.0
        };
    }

    duDoanVi(tong) {
        if (!tong) return [];
        return [
            ((tong % 6) + 10),
            ((tong % 6) + 11),
            ((tong % 6) + 12)
        ];
    }

    predict() {
        const fullHistory = this.historyMgr.getHistory();
        const historyLength = fullHistory.length;
        if (historyLength === 0) {
            return this.buildResult("Chưa xác định", 10, "Không có dữ liệu");
        }

        const recentHistory = this.historyMgr.getRecentHistory(100);
        const lastResult = recentHistory[recentHistory.length - 1].ket_qua;

        if (historyLength === 1) {
            const du_doan = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            return this.buildResult(du_doan, 30, "Chỉ có 1 phiên → dự đoán đảo cầu.");
        }

        let predictionScores = { 'Tài': 0, 'Xỉu': 0 };
        let dynamicWeights = { ...this.baseWeights };

        const recent30 = this.historyMgr.getRecentHistory(30);
        const recent10 = this.historyMgr.getRecentHistory(10);
        const recent20 = this.historyMgr.getRecentHistory(20);

        // Cầu bệt
        const taiSeq = this.historyMgr.calculateCurrentSequence(recent10, 'Tài');
        const xiuSeq = this.historyMgr.calculateCurrentSequence(recent10, 'Xỉu');
        if (taiSeq >= 4) predictionScores['Xỉu'] += taiSeq * dynamicWeights.bet;
        else if (xiuSeq >= 4) predictionScores['Tài'] += xiuSeq * dynamicWeights.bet;

        // Cầu đảo
        if (this.isAlternating(recent10, 1) && recent10.length >= 6) {
            predictionScores[(lastResult === 'Tài') ? "Xỉu" : "Tài"] += dynamicWeights.dao11;
        }
        if (this.isAlternating(recent10, 2) && recent10.length >= 8) {
            predictionScores[(lastResult === 'Tài') ? "Xỉu" : "Tài"] += dynamicWeights.dao22;
        }
        if (this.isAlternating(recent20, 3) && recent20.length >= 12) {
            predictionScores[(lastResult === 'Tài') ? "Xỉu" : "Tài"] += dynamicWeights.dao33;
        }

        // Mẫu lặp lại
        if (recent20.length >= 10) {
            const last5 = recent20.slice(-5).map(r => r.ket_qua).join("");
            const prev5 = recent20.slice(-10, -5).map(r => r.ket_qua).join("");
            if (last5 === prev5) {
                predictionScores[last5[0] === 'Tài' ? "Tài" : "Xỉu"] += dynamicWeights.mauLapLai;
            }
        }

        // Nhồi
        if (recent10.length >= 7) {
            const taiCount = recent10.filter(r => r.ket_qua === 'Tài').length;
            const xiuCount = recent10.filter(r => r.ket_qua === 'Xỉu').length;
            if (taiCount >= 5) predictionScores['Tài'] += dynamicWeights.uuTienGanDay;
            else if (xiuCount >= 5) predictionScores['Xỉu'] += dynamicWeights.uuTienGanDay;
        }

        // Tỷ lệ 30 phiên
        if (recent30.length >= 10) {
            const { taiRatio, xiuRatio } = this.historyMgr.calculateFrequency(recent30);
            if (Math.abs(taiRatio - xiuRatio) > 0.3) {
                const nextPred = (taiRatio > xiuRatio) ? "Xỉu" : "Tài";
                predictionScores[nextPred] += (Math.abs(taiRatio - xiuRatio) * 10) * dynamicWeights.tyLeApDao;
            }
        }

        // Default
        predictionScores[(lastResult === 'Tài') ? "Xỉu" : "Tài"] += dynamicWeights.default;

        // Kết quả
        let finalPrediction = predictionScores['Tài'] > predictionScores['Xỉu'] ? 'Tài' : 'Xỉu';
        let finalScore = predictionScores[finalPrediction];
        const totalScore = predictionScores['Tài'] + predictionScores['Xỉu'];
        let confidence = (finalScore / totalScore) * 100;

        confidence = confidence * Math.min(1, historyLength / 100);
        confidence = Math.min(99.99, Math.max(10, confidence));

        return this.buildResult(finalPrediction, confidence, "Thuật toán TT/XX phân tích.");
    }

    isAlternating(history, groupSize) {
        if (history.length < groupSize * 2) return false;
        const recent = history.slice(-groupSize * 2);
        return recent.slice(0, groupSize).every(r => r.ket_qua !== recent[groupSize].ket_qua);
    }

    buildResult(du_doan, do_tin_cay, giai_thich) {
        return { du_doan, do_tin_cay: do_tin_cay.toFixed(2), giai_thich };
    }
}

const historyManager = new HistoricalDataManager(500);
const predictionEngine = new PredictionEngine(historyManager);

// ⏰ Cronjob: Fetch API gốc mỗi 5s
setInterval(async () => {
    try {
        const response = await axios.get(SUNWIN_API_URL, { timeout: 5000 });
        const currentData = response.data;
        if (currentData && currentData.phien && currentData.ket_qua) {
            historyManager.addSession(currentData);
            dataCache.set("last_result", currentData);
            dataCache.set("full_history", historyManager.getHistory());
            console.log("✅ Fetched phien:", currentData.phien);
        }
    } catch (err) {
        console.error("⚠️ Cronjob fetch error:", err.message);
    }
}, 5000);

// API cho client → đọc cache, không gọi API gốc
app.get('/concac/ditme/lxk', (req, res) => {
    const currentData = dataCache.get("last_result");
    if (!currentData) {
        return res.status(500).json({ error: "Chưa có dữ liệu cache" });
    }

    const { du_doan, do_tin_cay, giai_thich } = predictionEngine.predict();
    const phien_truoc = currentData.phien;
    const tong_truoc = currentData.tong;
    const viDuDoan = predictionEngine.duDoanVi(tong_truoc);

    res.json({
        id: "@cskhtoollxk",
        phien_truoc,
        ket_qua: currentData.ket_qua,
        xuc_xac: [currentData.xuc_xac_1, currentData.xuc_xac_2, currentData.xuc_xac_3],
        tong: tong_truoc,
        phien_sau: phien_truoc + 1,
        du_doan,
        do_tin_cay,
        du_doan_vi: viDuDoan,
        giai_thich
    });
});

app.get('/', (req, res) => {
    res.send('API Sicbo SunWin NodeJS 🚀');
});

app.listen(PORT, () => {
    console.log(`✅ Server chạy cổng ${PORT}`);
});
