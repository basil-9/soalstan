const express = require('express'); // أضفنا تعريف express الناقص
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
    questionBank = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
} catch (e) {
    console.log("Error loading questions.json");
}

let roomsData = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, settings, team } = data;
        socket.join(roomID);
        socket.currentRoom = roomID;

        if (!roomsData[roomID]) {
            roomsData[roomID] = {
                // توحيد أسماء الفرق لتطابق المتصفح
                teams: { 
                    'A': { points: 100, leader: socket.id }, 
                    'B': { points: 100, leader: null } 
                },
                settings: settings || { roundTime: 30, maxRounds: 10 },
                currentQuestion: null, 
                turnTaken: false
            };
        } else {
            // إذا لم يكن هناك قائد للفريق المنضم إليه، اجعله القائد
            if (!roomsData[roomID].teams[team].leader) {
                roomsData[roomID].teams[team].leader = socket.id;
            }
        }

        const room = roomsData[roomID];
        // نرسل حالة القيادة بناءً على ما إذا كان الشخص هو القائد المسجل في فريقه
        const isLeader = socket.id === room.teams[team].leader;

        socket.emit('init', { 
            pointsA: room.teams['A'].points, 
            pointsB: room.teams['B'].points, 
            isLeader: isLeader, 
            settings: room.settings 
        });
    });

    socket.on('requestAuction', () => {
        const room = roomsData[socket.currentRoom];
        if(!room || questionBank.length === 0) return;
        const q = questionBank[Math.floor(Math.random() * questionBank.length)];
        room.currentQuestion = q; 
        room.turnTaken = false;
        io.to(socket.currentRoom).emit('startAuction', { hint: q.hint, fullQuestion: q });
    });

    socket.on('submitAnswer', (data) => {
        const room = roomsData[socket.currentRoom];
        if(!room) return;
        const isCorrect = data.answer === room.currentQuestion.a;
        if (isCorrect) {
            room.teams[data.team].points += 50;
            io.to(socket.currentRoom).emit('roundResult', { isCorrect: true, team: data.team, points: room.teams[data.team].points, name: data.name, correctAns: room.currentQuestion.a });
        } else {
            room.teams[data.team].points -= 30;
            if (!room.turnTaken) {
                room.turnTaken = true;
                const wrong = room.currentQuestion.options.filter(o => o !== room.currentQuestion.a);
                const newOptions = [room.currentQuestion.a, wrong[0], wrong[1]].sort(() => Math.random() - 0.5);
                io.to(socket.currentRoom).emit('passTurn', { toTeam: data.team === 'A' ? 'B' : 'A', newOptions, points: room.teams[data.team].points });
            } else {
                io.to(socket.currentRoom).emit('roundResult', { isCorrect: false, team: data.team, points: room.teams[data.team].points, name: data.name, correctAns: room.currentQuestion.a });
            }
        }
    });

    socket.on('placeBid', (d) => io.to(socket.currentRoom).emit('updateBid', d));
    socket.on('winAuction', (d) => io.to(socket.currentRoom).emit('revealQuestion', d));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🚀 سؤالستان تعمل بنظام القائد الموحد'));







