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

// نظام الحماية: يقرأ الأسئلة بدون ما يطيح السيرفر لو فيه خطأ
try {
    const data = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8');
    questionBank = JSON.parse(data);
    console.log(`✅ تم تحميل ${questionBank.length} سؤال بنجاح!`);
} catch (e) {
    console.error("❌ خطأ في ملف questions.json! تأكد من الفواصل والأقواس:", e.message);
    // سؤال بديل مؤقت عشان ما تخرب اللعبة
    questionBank = [{
        "type": "text", "hint": "تنبيه للقائد", "q": "يوجد خطأ (فاصلة أو قوس) في ملف questions.json، يرجى إصلاحه!", "options": ["حسناً", "جاري التعديل", "تم", "علم"], "a": "حسناً"
    }];
}

let roomsData = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, settings, team } = data;
        socket.join(roomID);
        socket.currentRoom = roomID;

        if (!roomsData[roomID]) {
            roomsData[roomID] = {
                teams: { 'A': { points: 100, leader: socket.id }, 'B': { points: 100, leader: null } },
                settings: settings || { roundTime: 30, maxRounds: 10 },
                currentQuestion: null, 
                currentRound: 0,
                turnTaken: false,
                firstTeam: null // لحل مشكلة خصم الوقت مرتين
            };
        } else if (team && !roomsData[roomID].teams[team].leader) {
            roomsData[roomID].teams[team].leader = socket.id;
        }

        const room = roomsData[roomID];
        socket.emit('init', { 
            pointsA: room.teams['A'].points, 
            pointsB: room.teams['B'].points, 
            isLeader: socket.id === room.teams['A'].leader || socket.id === room.teams['B'].leader, 
            settings: room.settings 
        });
    });

    socket.on('requestAuction', () => {
        const room = roomsData[socket.currentRoom];
        if(!room || questionBank.length === 0) return;

        room.currentRound++;
        if (room.currentRound > room.settings.maxRounds) {
            return io.to(socket.currentRoom).emit('gameOver', { pointsA: room.teams['A'].points, pointsB: room.teams['B'].points });
        }

        const q = questionBank[Math.floor(Math.random() * questionBank.length)];
        room.currentQuestion = q; 
        room.turnTaken = false;
        room.firstTeam = null;
        io.to(socket.currentRoom).emit('startAuction', { hint: q.hint, fullQuestion: q, roundNumber: room.currentRound });
    });

    // 💡 التعديل الأول: تغيير السؤال في نفس الجولة بدون زيادة العداد
    socket.on('changeQuestion', () => {
        const room = roomsData[socket.currentRoom];
        if(!room || questionBank.length === 0) return;

        const q = questionBank[Math.floor(Math.random() * questionBank.length)];
        room.currentQuestion = q; 
        room.turnTaken = false;
        room.firstTeam = null;
        io.to(socket.currentRoom).emit('startAuction', { hint: q.hint, fullQuestion: q, roundNumber: room.currentRound });
    });

    socket.on('submitAnswer', (data) => {
        const room = roomsData[socket.currentRoom];
        if(!room || !room.currentQuestion) return;
        
        // 💡 حماية: منع الفريق من الإجابة مرتين أو سحب نقاط مضاعفة عند انتهاء الوقت
        if (room.turnTaken && data.team === room.firstTeam) return;

        if (data.answer === "TIMEOUT") {
            room.teams[data.team].points -= 30;
            if (!room.turnTaken) {
                room.turnTaken = true;
                room.firstTeam = data.team;
                const wrong = room.currentQuestion.options.filter(o => o !== room.currentQuestion.a);
                const newOptions = [room.currentQuestion.a, wrong[0], wrong[1]].sort(() => Math.random() - 0.5);
                io.to(socket.currentRoom).emit('passTurn', { toTeam: data.team === 'A' ? 'B' : 'A', newOptions, points: room.teams[data.team].points });
            } else {
                const correctAns = room.currentQuestion.a;
                room.currentQuestion = null; // قفل السؤال تماماً
                io.to(socket.currentRoom).emit('roundResult', { isCorrect: false, team: data.team, points: room.teams[data.team].points, name: data.name, correctAns: correctAns });
            }
            return;
        }

        const isCorrect = data.answer === room.currentQuestion.a;
        if (isCorrect) {
            room.teams[data.team].points += 50;
            const correctAns = room.currentQuestion.a;
            room.currentQuestion = null; // قفل السؤال
            io.to(socket.currentRoom).emit('roundResult', { isCorrect: true, team: data.team, points: room.teams[data.team].points, name: data.name, correctAns: correctAns });
        } else {
            room.teams[data.team].points -= 30;
            if (!room.turnTaken) {
                room.turnTaken = true;
                room.firstTeam = data.team;
                const wrong = room.currentQuestion.options.filter(o => o !== room.currentQuestion.a);
                const newOptions = [room.currentQuestion.a, wrong[0], wrong[1]].sort(() => Math.random() - 0.5);
                io.to(socket.currentRoom).emit('passTurn', { toTeam: data.team === 'A' ? 'B' : 'A', newOptions, points: room.teams[data.team].points });
            } else {
                const correctAns = room.currentQuestion.a;
                room.currentQuestion = null; // قفل السؤال
                io.to(socket.currentRoom).emit('roundResult', { isCorrect: false, team: data.team, points: room.teams[data.team].points, name: data.name, correctAns: correctAns });
            }
        }
    });

    socket.on('placeBid', (d) => io.to(socket.currentRoom).emit('updateBid', d));
    socket.on('winAuction', (d) => io.to(socket.currentRoom).emit('revealQuestion', d));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🚀 Server running on port ' + PORT));




















