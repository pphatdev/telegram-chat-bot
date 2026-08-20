import { LoginForm } from '@/features/auth/components/login-form';

export default function LoginPage() {
    return (
        <main className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
            {/* Premium Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full bg-chat-pattern opacity-50 pointer-events-none" />
            <div className="absolute top-[10%] right-[10%] w-125 h-125 bg-primary/20 rounded-full blur-[100px] pointer-events-none animate-pulse duration-10000" />
            <div className="absolute bottom-[10%] left-[10%] w-150 h-150 bg-secondary/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-7000 delay-1000" />

            <div className="z-10 w-full px-4 flex justify-center">
                <LoginForm />
            </div>
        </main>
    );
}
