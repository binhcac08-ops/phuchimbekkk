const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// URL của API gốc
const SOURCE_API_URL = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1';

// Endpoint để lấy thông tin của phiên mới nhất
app.get('/api/taixiu/phien_gan_nhat', async (req, res) => {
    try {
        const response = await axios.get(SOURCE_API_URL);
        const data = response.data;

        // Truy cập đúng đường dẫn dữ liệu dựa trên hình ảnh bạn cung cấp
        if (!data || !data.data || !data.data.resultList || !Array.isArray(data.data.resultList) || data.data.resultList.length === 0) {
            console.error("Dữ liệu từ API gốc không hợp lệ hoặc rỗng.");
            return res.status(500).json({
                error: "Dữ liệu từ API gốc không hợp lệ hoặc rỗng.",
                details: "Cấu trúc phản hồi không như mong đợi."
            });
        }

        const latestResult = data.data.resultList[0];

        // Trích xuất và định dạng thông tin cần thiết
        const result = {
            phien: latestResult.gameNum,
            xuc_xac: latestResult.facesList
        };

        res.json(result);

    } catch (error) {
        console.error("Lỗi khi gọi API gốc:", error.message);
        res.status(500).json({
            error: "Không thể lấy dữ liệu từ API gốc.",
            details: error.message
        });
    }
});

// Endpoint mặc định
app.get('/', (req, res) => {
    res.send('Chào mừng đến với API Lấy Phiên Gần Nhất. Truy cập /api/taixiu/phien_gan_nhat để xem kết quả.');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

             
