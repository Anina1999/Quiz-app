const startButton = document.getElementById('start-btn');
const nextButton = document.getElementById('next-btn');
const questionContainerElement = document.getElementById('question-container');
const questionElement = document.getElementById('question');
const answerButtonsElement = document.getElementById('answer-buttons');
const scoreContainer = document.getElementById('score-container');
const progressElement = document.getElementById('progress');
const timerElement = document.getElementById('timer');
const finalScoreElement = document.getElementById('final-score');
const feedbackEmoji = document.getElementById('feedback-emoji');

const correctSound = document.getElementById('correct-sound');
const wrongSound = document.getElementById('wrong-sound');
correctSound.volume = 0.5;
wrongSound.volume = 0.5;

let shuffledQuestions, currentQuestionIndex;
let score = 0;
let timerInterval;
const timePerQuestion = 15;

startButton.addEventListener('click', startGame);
nextButton.addEventListener('click', () => {
    currentQuestionIndex++;
    setNextQuestion();
});

function startGame() {
    score = 0;
    scoreContainer.innerText = `Score: ${score}`;
    scoreContainer.classList.remove('hide');
    finalScoreElement.classList.add('hide');
    startButton.classList.add('hide');
    nextButton.classList.add('hide');
    questionContainerElement.classList.remove('final-center');
    progressElement.classList.remove('hide');

    questionElement.classList.remove('hide');
    answerButtonsElement.classList.remove('hide');

    shuffledQuestions = questions.sort(() => Math.random() - 0.5);
    currentQuestionIndex = 0;
    questionContainerElement.classList.remove('hide');
    setNextQuestion();
}

function setNextQuestion() {
    resetState();
    showProgress();
    showScore();
    showQuestion(shuffledQuestions[currentQuestionIndex]);
    resetTimer();
    startTimer();
}

function showProgress() {
    progressElement.innerText = `Question ${currentQuestionIndex + 1} of ${shuffledQuestions.length}`;
}

function showScore() {
    scoreContainer.innerText = `Score: ${score}`;
}

function showQuestion(question) {
    questionElement.innerText = question.question;
    question.answers.forEach(answer => {
        const button = document.createElement('button');
        button.innerText = answer.text;
        button.classList.add('btn');
        if (answer.correct) {
            button.dataset.correct = answer.correct;
        }
        button.addEventListener('click', selectAnswer);
        answerButtonsElement.appendChild(button);
    });
}

function resetState() {
    clearStatusClass(document.body);
    nextButton.classList.add('hide');
    while (answerButtonsElement.firstChild) {
        answerButtonsElement.removeChild(answerButtonsElement.firstChild);
    }
    enableAnswers();
}

function selectAnswer(e) {
    clearInterval(timerInterval);
    const selectedButton = e.target;
    const correct = selectedButton.dataset.correct === 'true';

    if(correct) {
        score++;
        correctSound.play();
        showFeedbackEmoji("👍");
    } else {
        wrongSound.play();
        showFeedbackEmoji("👎");
    }

    setStatusClass(document.body, correct);
    Array.from(answerButtonsElement.children).forEach(button => {
        setStatusClass(button, button.dataset.correct === 'true');
        button.disabled = true;
    });

    showScore();

    if (shuffledQuestions.length > currentQuestionIndex + 1) {
        nextButton.classList.remove('hide');
    } else {
        progressElement.classList.add('hide');
        questionElement.classList.add('hide');
        answerButtonsElement.classList.add('hide');
        nextButton.classList.add('hide');
        scoreContainer.classList.add('hide'); 
        finalScoreElement.innerHTML = `<span class="emoji">🎉</span> Final score: ${score} / ${shuffledQuestions.length} <span class="emoji">🎉</span>`;
        finalScoreElement.classList.remove('hide');
        finalScoreElement.classList.add('animate-final-score'); // Добави клас за анимация

        startButton.innerText = 'Start Again';
        startButton.classList.remove('hide');
        timerElement.innerText = '';
        questionContainerElement.classList.add('final-center');     
        }
    }

function setStatusClass(element, correct) {
    clearStatusClass(element);
    if (correct) {
        element.classList.add('correct');
    } else {
        element.classList.add('wrong');
    }
}

function clearStatusClass(element) {
    element.classList.remove('correct');
    element.classList.remove('wrong');
}

function startTimer() {
    let timeLeft = timePerQuestion;
    timerElement.innerText = `Time left: ${timeLeft}s`;

    timerInterval = setInterval(() => {
        timeLeft--;
        timerElement.innerText = `Time left: ${timeLeft}s`;
        if(timeLeft <= 0) {
            clearInterval(timerInterval);
            disableAnswers();
            nextButton.classList.remove('hide');
        }
    }, 1000);
}

function resetTimer() {
    clearInterval(timerInterval);
    timerElement.innerText = '';
}

function disableAnswers() {
    Array.from(answerButtonsElement.children).forEach(button => {
        button.disabled = true;
    });
}

function enableAnswers() {
    Array.from(answerButtonsElement.children).forEach(button => {
        button.disabled = false;
    });
}

function showFeedbackEmoji(emoji) {
    feedbackEmoji.innerText = emoji;
    feedbackEmoji.classList.remove('hide');
    feedbackEmoji.classList.add('animate-emoji');

    setTimeout(() => {
        feedbackEmoji.classList.add('hide');
        feedbackEmoji.classList.remove('animate-emoji');
    }, 1200);
}

const questions = [
    {
        question: 'What is the longest river in the world?',
        answers: [
            { text: 'Amazon River', correct: false },
            { text: 'Nile River', correct: true },
            { text: 'Yangtze River', correct: false },
            { text: 'Mississippi River', correct: false }
        ]
    },
    {
        question: 'What is the name of the largest tech company in South Korea?',
        answers: [
            { text: 'LG', correct: false },
            { text: 'Hyundai', correct: false },
            { text: 'Samsung', correct: true },
            { text: 'SK Telecom', correct: false }
        ]
    },
    {
        question: 'Who painted the Mona Lisa?',
        answers: [
            { text: 'Vincent van Gogh', correct: false },
            { text: 'Pablo Picasso', correct: false },
            { text: 'Leonardo da Vinci', correct: true },
            { text: 'Claude Monet', correct: false }
        ]
    },
    {
        question: 'What is the chemical symbol for water?',
        answers: [
            { text: 'H₂O', correct: true },
            { text: 'CO₂', correct: false },
            { text: 'O₂', correct: false },
            { text: 'NaCl', correct: false }
        ]
    },
    {
        question: 'What is the largest organ in the human body?',
        answers: [
            { text: 'Liver', correct: false },
            { text: 'Brain', correct: false },
            { text: 'Skin', correct: true },
            { text: 'Heart', correct: false }
        ]
    },
    {
        question: 'How many days are there in a year?',
        answers: [
            { text: '365.5', correct: false },
            { text: '360', correct: false },
            { text: '364', correct: false },
            { text: '365 (366 in a leap year)', correct: true }
        ]
    },
    {
        question: 'What is the name of a house made entirely of ice?',
        answers: [
            { text: 'Teepee', correct: false },
            { text: 'Cabin', correct: false },
            { text: 'Igloo', correct: true },
            { text: 'Bungalow', correct: false }
        ]
    }

];
