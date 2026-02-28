const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname)); 

// قراءة الأسئلة وضمان أنها تعمل
let questionBank = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8');
    questionBank = JSON.parse(data);
    console.log(`✅ تم تحميل ${questionBank.length} سؤال بنجاح!`);
} catch (err) { console.error("❌ خطأ في ملف الأسئلة:", err); }

// تخزين بيانات الغرف
let roomsData = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, name, team } = data;
        socket.join(roomID);
        socket.currentRoom = roomID;
        
        // إنشاء الغرفة إذا لم تكن موجودة وتعيين المشرف
        if (!roomsData[roomID]) {
            roomsData[roomID] = {
                teams: { 'أ': { points: 100 }, 'ب': { points: 100 } },
                usedQuestions: [],
                adminID: socket.id,
                timer: null
            };
        }

        const room = roomsData[roomID];
        // إبلاغ اللاعب بحالة النقاط وإذا كان مشرفاً
        socket.emit('init', { 
            pointsA: room.teams['أ'].points, 
            pointsB: room.teams['ب'].points,
            isAdmin: socket.id === room.adminID 
        });
    });

    socket.on('requestAuction', (data) => {
        const roomID = socket.currentRoom;
        if (!roomID || !roomsData[roomID]) return;

        // منع غير المشرف من الطلب
        if (socket.id !== roomsData[roomID].adminID) return;

        const available = questionBank.filter(q => !roomsData[roomID].usedQuestions.includes(q.q));
        const q = available.length > 0 
            ? available[Math.floor(Math.random() * available.length)] 
            : questionBank[Math.floor(Math.random() * questionBank.length)];

        roomsData[roomID].usedQuestions.push(q.q);
        io.to(roomID).emit('startAuction', { hint: q.hint, fullQuestion: q, level: data.level });
    });

    socket.on('winAuction', (data) => {
        const roomID = socket.currentRoom;
        if (!roomID || socket.id !== roomsData[roomID].adminID) return; // المشرف فقط

        let duration = data.level === 'easy' ? 25 : (data.level === 'hard' ? 12 : 18);
        io.to(roomID).emit('revealQuestion', { question: data.question, duration });
        
        // مسح أي عداد سابق وبدء واحد جديد
        clearInterval(roomsData[roomID].timer);
        roomsData[roomID].timer = setInterval(() => {
            duration--;
            io.to(roomID).emit('timerUpdate', duration);
            if (duration <= 0) {
                clearInterval(roomsData[roomID].timer);
                io.to(roomID).emit('roundResult', { playerName: "انتهى الوقت", isCorrect: false, team: 'أ', points: roomsData[roomID].teams['أ'].points });
            }
        }, 1000);
    });

    socket.on('submitAnswer', (data) => {
        const roomID = socket.currentRoom;
        if(roomsData[roomID]) clearInterval(roomsData[roomID].timer); // إيقاف العداد

        const isCorrect = data.answer === data.correct;
        if (roomsData[roomID]) {
            roomsData[roomID].teams[data.team].points += isCorrect ? 50 : -30;
            io.to(roomID).emit('roundResult', { 
                playerName: data.name, 
                isCorrect, 
                team: data.team, 
                points: roomsData[roomID].teams[data.team].points 
            });
        }
    });

    socket.on('placeBid', (data) => io.to(socket.currentRoom).emit('updateBid', data));
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 السيرفر يعمل على منفذ 3000'));


