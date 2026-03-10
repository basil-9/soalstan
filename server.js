const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 👑 إحصائيات المخرج (السرية) 👑 ---
let totalVisits = 0; 
let currentOnline = 0; 

// 1. الرابط السري للإحصائيات (مستحيل يخرب الحين)
app.get('/admin-stats', (req, res) => {
    const password = req.query.pass;

    if (password !== 'king123') {
        return res.status(403).send(`
            <body style="background:#0b0e14; color:#ef4444; text-align:center; font-family:sans-serif; margin-top:20%;">
                <h1>⛔ دخول ممنوع! مكان مخصص للمخرج فقط ⛔</h1>
            </body>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>لوحة تحكم المخرج 👑</title>
            <style>
                body { background: #0b0e14; color: white; font-family: 'Segoe UI', sans-serif; text-align: center; padding: 20px; }
                .stat-box { background: rgba(168, 85, 247, 0.1); border: 2px solid #a855f7; border-radius: 20px; padding: 30px; margin: 20px auto; max-width: 400px; box-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
                h1 { color: #facc15; font-size: 35px; text-shadow: 0 0 10px #facc15; }
                .number { font-size: 60px; font-weight: bold; color: #22c55e; margin: 10px 0; }
                button { background:#a855f7; color:white; border:none; padding:15px 30px; border-radius:12px; cursor:pointer; font-size:18px; font-weight:bold; transition:0.3s; margin-top:20px; }
                button:hover { background:#facc15; color:black; transform:scale(1.05); }
            </style>
        </head>
        <body>
            <h1>👑 إحصائيات سؤالستان 👑</h1>
            <div class="stat-box">
                <h2>👥 المتصلين الآن</h2>
                <div class="number">${currentOnline}</div>
            </div>
            <div class="stat-box">
                <h2>🚀 إجمالي الزيارات (للجلسة الحالية)</h2>
                <div class="number">${totalVisits}</div>
            </div>
            <button onclick="location.reload()">تحديث الإحصائيات 🔄</button>
        </body>
        </html>
    `);
});

// 2. الرادار الذكي لملف اللعبة (سواء حطيته برا أو داخل مجلد بيشغله)
app.get('/', (req, res) => {
    const rootPath = path.join(__dirname, 'index.html');
    const publicPath = path.join(__dirname, 'public', 'index.html');
    
    if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else {
        res.send("خطأ: لم يتم العثور على ملف index.html في مشروعك!");
    }
});

// 3. الرادار الذكي لملف الأسئلة
app.get('/questions.json', (req, res) => {
    const rootPath = path.join(__dirname, 'questions.json');
    const publicPath = path.join(__dirname, 'public', 'questions.json');
    
    if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else {
        res.json([]);
    }
});

app.use(express.static(__dirname));

// --- 🎮 تحميل الأسئلة للسيرفر للتحكيم 🎮 ---
let allQuestions = [];
try {
    const rootPath = path.join(__dirname, 'questions.json');
    const publicPath = path.join(__dirname, 'public', 'questions.json');
    const finalPath = fs.existsSync(rootPath) ? rootPath : publicPath;
    
    const rawData = fs.readFileSync(finalPath, 'utf8');
    allQuestions = JSON.parse(rawData);
    console.log(`✅ تم تحميل ${allQuestions.length} سؤال بنجاح!`);
} catch (e) {
    console.error("⚠️ ملف الأسئلة غير موجود!", e);
}

const rooms = {};

function normalizeString(text) {
    if (!text) return "";
    return text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي').replace(/[\u064B-\u065F]/g, '').trim();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

io.on('connection', (socket) => {
    // زيادة العداد بمجرد ما يفتح أحد الموقع!
    totalVisits++;
    currentOnline++;

    socket.on('joinRoom', (data) => {
        const { roomID, name, avatar, settings } = data;
        socket.join(roomID);
        socket.roomID = roomID;

        if (!rooms[roomID]) {
            rooms[roomID] = {
                id: roomID,
                leader: socket.id,
                players: {},
                settings: settings,
                currentRound: 0,
                questions: [],
                bluffs: {},
                votes: {},
                stats: {} 
            };
        }

        rooms[roomID].players[socket.id] = { id: socket.id, name: name, avatar: avatar, points: 0 };
        io.to(roomID).emit('updateState', { players: rooms[roomID].players, leader: rooms[roomID].leader });
    });

    socket.on('requestGameStart', () => {
        const room = rooms[socket.roomID];
        if (room && room.leader === socket.id) {
            let pool = allQuestions;
            if (room.settings.categories && room.settings.categories.length > 0) {
                pool = allQuestions.filter(q => {
                    let cat = q.category || q.hint || q.type;
                    return room.settings.categories.some(c => cat.includes(c));
                });
            }
            if (pool.length < room.settings.maxRounds) pool = allQuestions; 
            
            room.questions = shuffleArray([...pool]).slice(0, room.settings.maxRounds);
            room.currentRound = 0;
            
            Object.keys(room.players).forEach(pid => {
                room.players[pid].points = 0;
                room.stats[pid] = { trickedOthers: 0, gotTricked: 0, correctAnswers: 0 };
            });

            startNextRound(room);
        }
    });

    function startNextRound(room) {
        room.bluffs = {};
        room.votes = {};
        room.currentRound++;

        if (room.currentRound > room.settings.maxRounds) {
            return endGame(room);
        }

        const isDecisive = (room.currentRound === room.settings.maxRounds);
        const q = room.questions[room.currentRound - 1];

        io.to(room.id).emit('startBluffPhase', {
            roundNumber: room.currentRound,
            fullQuestion: q,
            isDecisive: isDecisive
        });
    }

    socket.on('submitBluff', (data) => {
        const room = rooms[socket.roomID];
        if (room) {
            room.bluffs[socket.id] = data.bluff;
            io.to(room.id).emit('playerActed', { id: socket.id, action: 'bluffed' });

            if (Object.keys(room.bluffs).length === Object.keys(room.players).length) {
                proceedToVoting(room);
            }
        }
    });

    socket.on('timeoutBluffAll', () => {
        const room = rooms[socket.roomID];
        if (room && room.leader === socket.id) proceedToVoting(room);
    });

    function proceedToVoting(room) {
        const q = room.questions[room.currentRound - 1];
        let options = [q.a]; 
        
        for (let pid in room.bluffs) {
            let b = room.bluffs[pid];
            if (normalizeString(b) !== normalizeString(q.a) && !options.includes(b)) {
                options.push(b);
            }
        }
        
        if (options.length < 4 && q.options) {
            for (let op of q.options) {
                if (!options.includes(op) && normalizeString(op) !== normalizeString(q.a)) {
                    options.push(op);
                    if (options.length >= 4) break;
                }
            }
        }

        io.to(room.id).emit('startVotingPhase', { options: shuffleArray(options) });
    }

    socket.on('submitVote', (data) => {
        const room = rooms[socket.roomID];
        if (room) {
            room.votes[socket.id] = data.vote;
            io.to(room.id).emit('playerActed', { id: socket.id, action: 'voted' });

            if (Object.keys(room.votes).length === Object.keys(room.players).length) {
                calculateResults(room);
            }
        }
    });

    socket.on('timeoutVoteAll', () => {
        const room = rooms[socket.roomID];
        if (room && room.leader === socket.id) calculateResults(room);
    });

    function calculateResults(room) {
        const q = room.questions[room.currentRound - 1];
        const isDecisive = (room.currentRound === room.settings.maxRounds);
        const correctPoints = isDecisive ? 100 : 50;
        const trickPoints = isDecisive ? 40 : 20;

        let roundData = {};
        for (let pid in room.players) {
            roundData[pid] = { name: room.players[pid].name, pointsGained: 0, votedFor: room.votes[pid] || null, tricked: [] };
        }

        for (let voterId in room.votes) {
            let vote = room.votes[voterId];
            
            if (normalizeString(vote) === normalizeString(q.a)) {
                room.players[voterId].points += correctPoints;
                roundData[voterId].pointsGained += correctPoints;
                room.stats[voterId].correctAnswers++;
            } else {
                for (let blufferId in room.bluffs) {
                    if (blufferId !== voterId && normalizeString(vote) === normalizeString(room.bluffs[blufferId])) {
                        room.players[blufferId].points += trickPoints;
                        roundData[blufferId].pointsGained += trickPoints;
                        roundData[blufferId].tricked.push(room.players[voterId].name);
                        
                        room.stats[blufferId].trickedOthers++;
                        room.stats[voterId].gotTricked++;
                        break;
                    }
                }
            }
        }

        io.to(room.id).emit('roundResult', { results: roundData, correctAns: q.a });
        io.to(room.id).emit('updateState', { players: room.players, leader: room.leader });

        setTimeout(() => { startNextRound(room); }, 6000); 
    }

    function endGame(room) {
        let titles = { bluffer: null, victim: null, nerd: null };
        let maxTricks = 0, maxVictim = 0, maxCorrect = 0;

        for (let pid in room.stats) {
            if (room.stats[pid].trickedOthers > maxTricks && room.stats[pid].trickedOthers >= 2) {
                maxTricks = room.stats[pid].trickedOthers;
                titles.bluffer = room.players[pid].name;
            }
            if (room.stats[pid].gotTricked > maxVictim && room.stats[pid].gotTricked >= 2) {
                maxVictim = room.stats[pid].gotTricked;
                titles.victim = room.players[pid].name;
            }
            if (room.stats[pid].correctAnswers > maxCorrect && room.stats[pid].correctAnswers >= 3) {
                maxCorrect = room.stats[pid].correctAnswers;
                titles.nerd = room.players[pid].name;
            }
        }

        io.to(room.id).emit('gameOver', { players: room.players, titles: titles });
    }

    socket.on('restartGame', () => {
        const room = rooms[socket.roomID];
        if (room && room.leader === socket.id) {
            io.to(room.id).emit('gameRestarted');
        }
    });

    socket.on('disconnect', () => {
        // إنقاص العداد لما يطلع اللاعب
        currentOnline--;
        if (currentOnline < 0) currentOnline = 0; 
        
        if (socket.roomID && rooms[socket.roomID]) {
            const room = rooms[socket.roomID];
            delete room.players[socket.id];
            
            if (room.leader === socket.id) {
                const remaining = Object.keys(room.players);
                if (remaining.length > 0) room.leader = remaining[0];
            }
            
            if (Object.keys(room.players).length === 0) delete rooms[socket.roomID];
            else io.to(socket.roomID).emit('updateState', { players: room.players, leader: room.leader });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
});






