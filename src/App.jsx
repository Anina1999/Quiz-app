import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { useStudent } from './lib/student.jsx';
import { Loading } from './components/ui.jsx';

import Home from './pages/Home.jsx';
import TeacherLogin from './pages/TeacherLogin.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import ClassPage from './pages/ClassPage.jsx';
import QuizEditor from './pages/QuizEditor.jsx';
import AttemptReport from './pages/AttemptReport.jsx';
import StudentJoin from './pages/StudentJoin.jsx';
import StudentQuizzes from './pages/StudentQuizzes.jsx';
import Play from './pages/Play.jsx';

function RequireTeacher({ children }) {
    const { session, teacher, loading } = useAuth();
    const location = useLocation();

    if (loading) return <Loading />;
    if (!session || !session.user?.email) {
        return <Navigate to="/teacher/login" state={{ from: location }} replace />;
    }
    if (!teacher) return <Loading>Зареждане на профила…</Loading>;
    return children;
}

function RequireStudent({ children }) {
    const { student } = useStudent();
    if (!student) return <Navigate to="/student" replace />;
    return children;
}

function AppBar() {
    const { teacher, signOut } = useAuth();
    const { student, leave } = useStudent();
    const navigate = useNavigate();

    /*
     * След изход се връщаме на началния екран с избора „ученик / учител“.
     *
     * Редът има значение: първо навигацията, чак после прекратяването на
     * сесията. Ако е обратното, изчезването на сесията размонтира защитената
     * страница и <RequireTeacher> подава свое пренасочване към формата за вход.
     * То се изпълнява в ефект СЛЕД рендера и презаписва нашето — затова
     * потребителят оставаше на „Вход за учители“.
     */
    async function exit(action) {
        navigate('/', { replace: true });
        await action();
    }

    return (
        <header className="appbar">
            <div className="appbar__inner">
                <Link to="/" className="appbar__title">
                    📚 Тестове 1.–4. клас
                </Link>
                <div className="spacer" />
                {teacher && (
                    <>
                        <span className="small muted">{teacher.full_name}</span>
                        <button type="button" className="btn btn--quiet" onClick={() => exit(signOut)}>
                            Изход
                        </button>
                    </>
                )}
                {!teacher && student && (
                    <>
                        <span className="small muted">
                            {student.display_name} · {student.class?.name}
                        </span>
                        <button type="button" className="btn btn--quiet" onClick={() => exit(leave)}>
                            Изход
                        </button>
                    </>
                )}
            </div>
        </header>
    );
}

export default function App() {
    return (
        <>
            <a className="skip-link" href="#main">
                Към основното съдържание
            </a>
            <AppBar />
            <main id="main">
                <Routes>
                    <Route path="/" element={<Home />} />

                    <Route path="/teacher/login" element={<TeacherLogin />} />
                    <Route
                        path="/teacher"
                        element={
                            <RequireTeacher>
                                <TeacherDashboard />
                            </RequireTeacher>
                        }
                    />
                    <Route
                        path="/teacher/class/:classId"
                        element={
                            <RequireTeacher>
                                <ClassPage />
                            </RequireTeacher>
                        }
                    />
                    <Route
                        path="/teacher/attempt/:attemptId"
                        element={
                            <RequireTeacher>
                                <AttemptReport />
                            </RequireTeacher>
                        }
                    />
                    <Route
                        path="/teacher/quiz/:quizId"
                        element={
                            <RequireTeacher>
                                <QuizEditor />
                            </RequireTeacher>
                        }
                    />

                    <Route path="/student" element={<StudentJoin />} />
                    <Route
                        path="/student/quizzes"
                        element={
                            <RequireStudent>
                                <StudentQuizzes />
                            </RequireStudent>
                        }
                    />
                    <Route
                        path="/student/play/:quizId"
                        element={
                            <RequireStudent>
                                <Play />
                            </RequireStudent>
                        }
                    />

                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </>
    );
}
