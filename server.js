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
} catch (err) { console.error("❌ خطأ في الأسئلة"); }

let roomsData = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, name, team } = data;
        socket.join(roomID);
        socket.currentRoom = roomID;
        if (!roomsData[roomID]) {
            roomsData[roomID] = { 
                teams: { 'أ': { points: 100 }, 'ب': { points: 100 } }, 
                adminID: socket.id, 
                isSuddenDeath: false,
                usedQuestions: []
            };
        }
        socket.emit('init', { 
            pointsA: roomsData[roomID].teams['أ'].points, 
            pointsB: roomsData[roomID].teams['ب'].points, 
            isAdmin: socket.id === roomsData[roomID].adminID 
        });
    });

    socket.on('requestAuction', (data) => {
        const roomID = socket.currentRoom;
        const room = roomsData[roomID];
        if (!room || socket.id !== room.adminID) return;

        if (room.teams['أ'].points > 500 || room.teams['ب'].points > 500) room.isSuddenDeath = true;
        
        const available = questionBank.filter(q => !room.usedQuestions.includes(q.q));
        const q = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : questionBank[0];
        room.usedQuestions.push(q.q);

        io.to(roomID).emit('startAuction', { 
            hint: q.hint, fullQuestion: q, level: data.level, isSuddenDeath: room.isSuddenDeath 
        });
    });

    socket.on('winAuction', (data) => {
        const roomID = socket.currentRoom;
        let timeLeft = data.level === 'easy' ? 25 : (data.level === 'hard' ? 12 : 18);
        io.to(roomID).emit('revealQuestion', { question: data.question, duration: timeLeft });
    });

    socket.on('submitAnswer', (data) => {
        const room = roomsData[socket.currentRoom];
        const isCorrect = data.answer === data.correct;
        const multiplier = data.isDouble ? 2 : 1;
        
        if (isCorrect) room.teams[data.team].points += (50 * multiplier);
        else room.teams[data.team].points -= (30 * multiplier);

        io.to(socket.currentRoom).emit('roundResult', { 
            isCorrect, team: data.team, points: room.teams[data.team].points, playerName: data.name 
        });
    });

    socket.on('placeBid', (data) => io.to(socket.currentRoom).emit('updateBid', data));
});

server.listen(process.env.PORT || 3000);



