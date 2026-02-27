const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname)); 

let questionBank = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8');
    questionBank = JSON.parse(data);
} catch (err) { console.error("❌ خطأ في ملف الأسئلة:", err); }

let roomsData = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, name, team } = data;
        socket.join(roomID);
        socket.currentRoom = roomID;
        socket.playerName = name;
        socket.playerTeam = team;

        if (!roomsData[roomID]) {
            roomsData[roomID] = {
                teams: { 'أ': { points: 100 }, 'ب': { points: 100 } },
                usedQuestions: [],
                adminID: socket.id 
            };
        }

        const room = roomsData[roomID];
        socket.emit('init', { 
            pointsA: room.teams['أ'].points, 
            pointsB: room.teams['ب'].points,
            isAdmin: socket.id === room.adminID 
        });
    });

    socket.on('requestAuction', (data) => {
        const roomID = socket.currentRoom;
        if (!roomID || socket.id !== roomsData[roomID].adminID) return;

        const available = questionBank.filter(q => !roomsData[roomID].usedQuestions.includes(q.q));
        const q = available.length > 0 
            ? available[Math.floor(Math.random() * available.length)] 
            : questionBank[Math.floor(Math.random() * questionBank.length)];

        roomsData[roomID].usedQuestions.push(q.q);
        io.to(roomID).emit('startAuction', { hint: q.hint, fullQuestion: q, level: data.level });
    });

    socket.on('placeBid', (data) => {
        io.to(socket.currentRoom).emit('updateBid', data);
    });

    socket.on('winAuction', (data) => {
        const roomID = socket.currentRoom;
        if (socket.id !== roomsData[roomID].adminID) return;
        let duration = data.level === 'easy' ? 20 : (data.level === 'hard' ? 10 : 15);
        io.to(roomID).emit('revealQuestion', { question: data.question, duration });
    });

    socket.on('submitAnswer', (data) => {
        const roomID = socket.currentRoom;
        const isCorrect = data.answer === data.correct;
        if (roomsData[roomID]) {
            roomsData[roomID].teams[data.team].points += isCorrect ? 50 : -30;
            io.to(roomID).emit('roundResult', { 
                playerName: data.name, isCorrect, team: data.team, points: roomsData[roomID].teams[data.team].points 
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 السيرفر يعمل على منفذ ${PORT}`));

