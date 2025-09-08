const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Khởi tạo cache cho lịch sử dữ liệu với thời gian sống 1 giờ (3600 giây)
const historicalDataCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// URL API gốc của Sunwin để lấy dữ liệu Tài Xỉu
const SUNWIN_API_URL = 'https://sicbosun-6esb.onrender.com/api/sicbosun';

/**
 * Lớp quản lý dữ liệu lịch sử và các phép tính cơ bản.
 * Giúp code gọn gàng và dễ bảo trì hơn.
 */
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
        const taiRatio = totalCount > 0 ? taiCount / totalCount : 0;
        const xiuRatio = totalCount > 0 ? xiuCount / totalCount : 0;
        return { taiCount, xiuCount, totalCount, taiRatio, xiuRatio };
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

/**
 * Lớp thuật toán phân tích đa chiều để đưa ra dự đoán với độ tin cậy cao.
 */
class PredictionEngine {
    constructor(historyMgr) {
        this.historyMgr = historyMgr;
        // Trọng số cho các thuật toán, có thể điều chỉnh
        this.baseWeights = {
            bet: 5.0, // Cầu Bệt
            dao11: 4.5, // Cầu Đảo 1-1
            dao22: 4.0, // Cầu Đảo 2-2
            tyLeApDao: 3.0, // Tỷ lệ áp đảo
            daoDongThap: 2.5, // Cầu gãy (Đảo 2-1 hoặc 1-2)
            mauLapLai: 2.0, // Mẫu hình lặp lại
            default: 1.0 // Dự đoán cơ bản
        };
    }

    predict() {
        const fullHistory = this.historyMgr.getHistory();
        const historyLength = fullHistory.length;

        // Xử lý trường hợp không có dữ liệu
        if (historyLength === 0) {
            return this.buildResult("Chưa xác định", 10, "Không có dữ liệu lịch sử để phân tích.", "Không có dữ liệu");
        }

        const recentHistory = this.historyMgr.getRecentHistory(100);
        const lastResult = recentHistory[recentHistory.length - 1].ket_qua;
        
        // Trường hợp chỉ có 1 phiên lịch sử: đưa ra dự đoán cơ bản nhất
        if (historyLength === 1) {
            const du_doan = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            return this.buildResult(du_doan, 30, `Chỉ có 1 phiên lịch sử (${lastResult}). Dự đoán bẻ cầu để bắt đầu phân tích.`, "Dự đoán cơ bản");
        }

        let predictionScores = { 'Tài': 0, 'Xỉu': 0 };
        let explanations = [];
        let identifiedPattern = "Chưa nhận diện mẫu hình mạnh.";
        let dynamicWeights = { ...this.baseWeights };

        const recent30 = this.historyMgr.getRecentHistory(30);
        const recent10 = this.historyMgr.getRecentHistory(10);

        // Thuật toán 1: Phân tích cầu Bệt (ít nhất 4 phiên liên tiếp)
        const taiSequence = this.historyMgr.calculateCurrentSequence(recent10, 'Tài');
        const xiuSequence = this.historyMgr.calculateCurrentSequence(recent10, 'Xỉu');
        if (taiSequence >= 4) {
            predictionScores['Xỉu'] += taiSequence * dynamicWeights.bet;
            explanations.push(`**CẦU BỆT TÀI DÀI (${taiSequence} phiên):** Khả năng bẻ cầu rất cao. Đặt Xỉu.`);
            identifiedPattern = `Cầu Bệt Tài (${taiSequence} phiên)`;
        } else if (xiuSequence >= 4) {
            predictionScores['Tài'] += xiuSequence * dynamicWeights.bet;
            explanations.push(`**CẦU BỆT XỈU DÀI (${xiuSequence} phiên):** Khả năng bẻ cầu rất cao. Đặt Tài.`);
            identifiedPattern = `Cầu Bệt Xỉu (${xiuSequence} phiên)`;
        }

        // Thuật toán 2: Phân tích cầu Đảo (1-1, 2-2)
        if (this.isAlternating(recent10, 1) && recent10.length >= 6) {
            const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPrediction] += dynamicWeights.dao11;
            explanations.push(`**CẦU ĐẢO 1-1 RÕ NÉT:** Thị trường đang đi theo mẫu luân phiên. Đặt ${nextPrediction}.`);
            identifiedPattern = "Cầu Đảo (1-1)";
        }
        if (this.isAlternating(recent10, 2) && recent10.length >= 8) {
            const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPrediction] += dynamicWeights.dao22;
            explanations.push(`**CẦU ĐẢO 2-2:** Mẫu hình Tài-Tài-Xỉu-Xỉu đang lặp lại. Đặt ${nextPrediction}.`);
            identifiedPattern = identifiedPattern === "Chưa nhận diện mẫu hình mạnh." ? "Cầu Đảo (2-2)" : identifiedPattern;
        }

        // Thuật toán 3: Phân tích Cầu Gãy
        if (taiSequence === 2 && recent10[recent10.length-3]?.ket_qua === 'Xỉu' && recent10.length >= 3) {
            predictionScores['Xỉu'] += dynamicWeights.daoDongThap;
            explanations.push(`**DẤU HIỆU CẦU GÃY:** Hai phiên Tài sau một phiên Xỉu. Mẫu hình dễ gãy.`);
        }
        if (xiuSequence === 2 && recent10[recent10.length-3]?.ket_qua === 'Tài' && recent10.length >= 3) {
            predictionScores['Tài'] += dynamicWeights.daoDongThap;
            explanations.push(`**DẤU HIỆU CẦU GÃY:** Hai phiên Xỉu sau một phiên Tài. Mẫu hình dễ gãy.`);
        }

        // Thuật toán 4: Phân tích tỷ lệ Tài/Xỉu trên 30 phiên (nếu có đủ dữ liệu)
        if (recent30.length >= 10) {
            const { taiRatio, xiuRatio } = this.historyMgr.calculateFrequency(recent30);
            if (Math.abs(taiRatio - xiuRatio) > 0.3) {
                const nextPrediction = (taiRatio > xiuRatio) ? "Xỉu" : "Tài";
                predictionScores[nextPrediction] += (Math.abs(taiRatio - xiuRatio) * 10) * dynamicWeights.tyLeApDao;
                explanations.push(`**CÂN BẰNG THỊ TRƯỜNG (30 phiên):** Tỷ lệ đang mất cân bằng (${(taiRatio*100).toFixed(0)}% vs ${(xiuRatio*100).toFixed(0)}%). Hệ thống dự đoán thị trường sẽ cân bằng lại.`);
            }
        }

        // Thuật toán 5: Phân tích mẫu hình lặp lại
        if (recent10.length >= 4) {
            const patternToMatch = recent10.slice(-2).map(p => p.ket_qua).join('-');
            const pastChunk = recent10.slice(0, -2);
            let countMatch = 0;
            for(let i=0; i < pastChunk.length - 1; i++) {
                if (`${pastChunk[i].ket_qua}-${pastChunk[i+1].ket_qua}` === patternToMatch) {
                    countMatch++;
                }
            }
            if (countMatch > 1) { // Mẫu hình lặp lại ít nhất 2 lần
                const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài"; // Dự đoán ngược lại
                predictionScores[nextPrediction] += countMatch * dynamicWeights.mauLapLai;
                explanations.push(`**MẪU HÌNH LẶP LẠI:** Chuỗi "${patternToMatch}" đã lặp lại ${countMatch} lần trong 10 phiên. Có xu hướng bẻ cầu.`);
            }
        }
        
        // Thuật toán 6: Dự đoán cơ bản (luôn tồn tại)
        const defaultPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
        predictionScores[defaultPrediction] += dynamicWeights.default;
        explanations.push(`**DỰ ĐOÁN CƠ SỞ:** Không có mẫu hình mạnh. Dự đoán đảo cầu theo phiên gần nhất.`);

        // --- Tổng hợp và đưa ra kết quả cuối cùng ---
        let finalPrediction = "Chưa xác định";
        let finalScore = 0;
        if (predictionScores['Tài'] > predictionScores['Xỉu']) {
            finalPrediction = 'Tài';
            finalScore = predictionScores['Tài'];
        } else if (predictionScores['Xỉu'] > predictionScores['Tài']) {
            finalPrediction = 'Xỉu';
            finalScore = predictionScores['Xỉu'];
        } else {
            finalPrediction = defaultPrediction;
            finalScore = predictionScores[defaultPrediction];
        }

        const totalScore = predictionScores['Tài'] + predictionScores['Xỉu'];
        let confidence = (finalScore / totalScore) * 100;
        
        // Điều chỉnh độ tin cậy dựa trên số lượng dữ liệu
        confidence = confidence * Math.min(1, historyLength / 100); // Tối đa 100 phiên để đạt độ tin cậy cao nhất
        confidence = Math.min(99.99, Math.max(10, confidence));

        return this.buildResult(finalPrediction, confidence, explanations.join(" "), identifiedPattern);
    }
    
    // Các hàm hỗ trợ cho thuật toán
    isAlternating(history, groupSize) {
        if (history.length < groupSize * 2) return false;
        const recent = history.slice(-groupSize * 2);
        for (let i = 0; i < recent.length; i += groupSize * 2) {
            const group1 = recent.slice(i, i + groupSize);
            const group2 = recent.slice(i + groupSize, i + groupSize * 2);
            if (group1.length !== group2.length || group1[0].ket_qua === group2[0].ket_qua) {
                return false;
            }
        }
        return true;
    }

    buildResult(du_doan, do_tin_cay, giai_thich, pattern) {
        return {
            du_doan: du_doan,
            do_tin_cay: do_tin_cay.toFixed(2),
            giai_thich: giai_thich,
            pattern_nhan_dien: pattern
        };
    }
}

// Khởi tạo trình quản lý lịch sử và công cụ dự đoán
const historyManager = new HistoricalDataManager(500);
const predictionEngine = new PredictionEngine(historyManager);


// --- API Endpoints ---

app.get('/concac/ditme/lxk', async (req, res) => {
    let currentData = null;
    let cachedHistoricalData = historicalDataCache.get("full_history");

    if (cachedHistoricalData) {
        historyManager.history = cachedHistoricalData;
    }

    try {
        const response = await axios.get(SUNWIN_API_URL, { timeout: 5000 });
        currentData = response.data;

        if (currentData && currentData.phien && currentData.ket_qua) {
            historyManager.addSession(currentData);
            historicalDataCache.set("full_history", historyManager.getHistory());
        }

        const { du_doan, do_tin_cay, giai_thich, pattern_nhan_dien } = predictionEngine.predict();

        const result = {
            id: "@cskhtoollxk",
            thoi_gian_cap_nhat: new Date().toISOString(),
            phien: currentData ? currentData.phien : null,
            ket_qua: currentData ? currentData.ket_qua : null,
            xuc_xac: currentData ? [currentData.xuc_xac_1, currentData.xuc_xac_2, currentData.xuc_xac_3] : [],
            tong: currentData ? currentData.tong : null,
            phien_sau: currentData ? currentData.phien + 1 : (historyManager.getHistory().length > 0 ? historyManager.getHistory().slice(-1)[0].phien + 1 : null),
            du_doan: du_doan,
            do_tin_cay: do_tin_cay,
            giai_thich: giai_thich,
            pattern_nhan_dien: pattern_nhan_dien,
            tong_so_phien_da_phan_tich: historyManager.getHistory().length
        };

        res.json(result);

    } catch (error) {
        console.error("Lỗi khi gọi API hoặc xử lý dữ liệu:", error.message);
        if (historyManager.getHistory().length > 0) {
            const { du_doan, do_tin_cay, giai_thich, pattern_nhan_dien } = predictionEngine.predict();
             res.status(200).json({
                id: "@cskhtoollxk",
                thoi_gian_cap_nhat: new Date().toISOString(),
                error_from_api: "Không thể lấy dữ liệu phiên hiện tại. Sử dụng dữ liệu lịch sử cached.",
                phien_sau: historyManager.getHistory().slice(-1)[0].phien + 1,
                du_doan: du_doan,
                do_tin_cay: (parseFloat(do_tin_cay) * 0.8).toFixed(2), // Giảm độ tin cậy khi dùng dữ liệu cache
                giai_thich: `(Lỗi API gốc) ${giai_thich}`,
                pattern_nhan_dien: pattern_nhan_dien,
                tong_so_phien_da_phan_tich: historyManager.getHistory().length
            });
        } else {
             res.status(500).json({
                id: "@cskhtoollxk",
                thoi_gian_cap_nhat: new Date().toISOString(),
                error: "Không thể lấy dữ liệu từ API gốc và không có lịch sử để phân tích.",
                du_doan: "Không thể dự đoán",
                do_tin_cay: 0,
                giai_thich: "Lỗi hệ thống. Không có dữ liệu để phân tích.",
                pattern_nhan_dien: "Lỗi hệ thống",
                tong_so_phien_da_phan_tich: 0
            });
        }
    }
});

app.get('/', (req, res) => {
    res.send('CÓ CÁI ĐẦU BUỒI');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});