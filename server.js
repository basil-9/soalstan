const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname)); // للسماح بالوصول لملفات الصور والـ CSS

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// 1. تحميل الأسئلة من الملف الخارجي (الـ 1000 سؤال)
let questionBank = [];
let usedQuestions = []; 

try {
    const data = fs.readFileSync('questions.json', 'utf8');
    questionBank = JSON.parse(data);
    console.log(`✅ تم تحميل ${questionBank.length} سؤال بنجاح!`);
} catch (err) {
    console.error("❌ خطأ في تحميل ملف الأسئلة:", err);
}

let players = 0;
// تهيئة النقاط للفريقين
let teams = { 'أ': { points: 100 }, 'ب': { points: 100 } };

io.on('connection', (socket) => {
    players++;
    const team = players % 2 !== 0 ? 'أ' : 'ب'; // توزيع عادل للفريقين
    socket.emit('init', { team, pointsA: teams['أ'].points, pointsB: teams['ب'].points });

    // 2. استقبال طلب المزاد مع المستوى المختار
    socket.on('requestAuction', (data) => {
        const level = data.level || 'medium'; // افتراضي متوسط إذا لم يحدد
        
        if (usedQuestions.length >= questionBank.length) usedQuestions = [];

        // اختيار سؤال عشوائي لم يستخدم
        let q;
        const availableQuestions = questionBank.filter(item => !usedQuestions.includes(item.q));
        
        if (availableQuestions.length > 0) {
            q = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
        } else {
            q = questionBank[Math.floor(Math.random() * questionBank.length)];
            usedQuestions = [];
        }

        usedQuestions.push(q.q);
        
        // إرسال المستوى والتلميح للكل
        io.emit('startAuction', { 
            hint: q.hint, 
            fullQuestion: q, 
            level: level 
        });
    });

    socket.on('placeBid', (data) => {
        io.emit('updateBid', { team: data.team, amount: data.amount });
    });

    // 3. إرساء المزاد وتحديد مدة العداد بناءً على المستوى
    socket.on('winAuction', (data) => {
        let duration = 15; // الافتراضي للمتوسط
        const level = data.level || 'medium';

        if (level === 'easy') duration = 20;
        else if (level === 'hard') duration = 10;

        io.emit('revealQuestion', { 
            question: data.question, 
            duration: duration 
        });
    });

    socket.on('submitAnswer', (data) => {
        const isCorrect = data.answer === data.correct;
        // نظام المكافأة والعقاب
        if(isCorrect) teams[data.team].points += 50;
        else teams[data.team].points -= 30;

        io.emit('roundResult', { 
            team: data.team, 
            isCorrect, 
            points: teams[data.team].points 
        });
    });

    socket.on('disconnect', () => { players--; });
});

server.listen(3000, () => console.log('🚀 مزاد سؤالستان المطور يعمل على المنفذ 3000'));