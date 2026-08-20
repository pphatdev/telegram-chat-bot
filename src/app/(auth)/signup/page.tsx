import { SignupForm } from '@/features/auth/components/signup-form';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign Up | Telegram Bot Platform',
    description: 'Create an account to manage your bots',
};

export default function SignupPage() {
    return (
        <main className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
            {/* Premium Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full bg-chat-pattern opacity-50 pointer-events-none" />
            <div className="absolute top-[10%] left-[10%] w-125 h-125 bg-secondary/20 rounded-full blur-[100px] pointer-events-none animate-pulse duration-10000" />
            <div className="absolute bottom-[10%] right-[10%] w-150 h-150 bg-primary/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-7000 delay-1000" />

            {/* Container to handle padding on small screens */}
            <div className="w-full max-w-5xl px-4 sm:px-0 relative z-10 flex flex-col items-center justify-center min-h-screen py-12">
                <SignupForm />
            </div>
        </main>
    );
}
