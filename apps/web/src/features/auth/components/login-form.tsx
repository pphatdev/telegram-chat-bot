"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, ArrowRight, Loader2, KeyRound, AtSign, Lock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loginWithApiKey, loginWithCredentials } from "@/features/auth/actions";
import {
    loginApiKeySchema,
    loginCredentialsSchema,
    type LoginApiKeyInput,
    type LoginCredentialsInput,
} from "@telegram-bot/shared/schemas/auth";

const INPUT_CLASSES =
    "w-full h-14 pl-12 pr-4 rounded-[20px] bg-black/5 dark:bg-white/5 border border-white/10 focus:bg-background/80 focus:border-primary/50 focus:ring-4 focus:ring-primary/20 outline-none transition-all duration-300 text-[15px] shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset]";

export function LoginForm() {
    const [loginMethod, setLoginMethod] = useState<"apiKey" | "credentials">("apiKey");
    const [isLoading, setIsLoading] = useState(false);
    const [rememberBot, setRememberBot] = useState(true);

    const apiKeyForm = useForm<LoginApiKeyInput>({
        resolver: zodResolver(loginApiKeySchema),
        mode: "onBlur",
        defaultValues: {
            token: "1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa",
        },
    });

    const credentialsForm = useForm<LoginCredentialsInput>({
        resolver: zodResolver(loginCredentialsSchema),
        mode: "onBlur",
        defaultValues: { username: "", password: "" },
    });

    const activeFormIsValid =
        loginMethod === "apiKey"
            ? apiKeyForm.formState.isValid
            : credentialsForm.formState.isValid;

    const onApiKeySubmit = async (values: LoginApiKeyInput) => {
        setIsLoading(true);
        const result = await loginWithApiKey(values);
        if (result.ok) {
            if (result.warning) toast.warning(result.warning);
            window.location.href = "/";
            return;
        }
        setIsLoading(false);
        if (result.field === "token") {
            apiKeyForm.setError("token", { type: "server", message: result.error });
        } else {
            toast.error(result.error);
        }
    };

    const onCredentialsSubmit = async (values: LoginCredentialsInput) => {
        setIsLoading(true);
        const result = await loginWithCredentials(values);
        if (result.ok) {
            window.location.href = "/";
            return;
        }
        setIsLoading(false);
        toast.error(result.error);
    };

    void rememberBot; // Forwarded to session issuer in a follow-up phase.

    return (
        <div className="w-full max-w-105 bg-background/40 backdrop-blur-3xl rounded-[36px] p-8 shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-secondary/20 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 rounded-[24px] bg-gradient-to-b from-primary/30 to-primary/5 flex items-center justify-center mb-6 shadow-[0_8px_32px_rgba(13,148,136,0.3),0_1px_1px_rgba(255,255,255,0.4)_inset] backdrop-blur-xl border border-white/10">
                    <Bot className="w-10 h-10 text-primary drop-shadow-md" />
                </div>

                <h1 className="text-2xl font-bold text-foreground mb-2 text-center">Sign in to Bot Panel</h1>
                <p className="text-muted-foreground text-center mb-8 text-[15px]">
                    Please enter your Telegram Bot Token. You can get one from{" "}
                    <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                        @BotFather
                    </a>
                    .
                </p>

                <Tabs
                    value={loginMethod}
                    onValueChange={(v) => setLoginMethod(v as "apiKey" | "credentials")}
                    className="w-full mb-6 gap-4"
                >
                    <TabsList className="w-full h-auto rounded-[24px] p-1.5 bg-black/5 dark:bg-white/5 border border-white/10 backdrop-blur-xl shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset]">
                        <TabsTrigger
                            value="apiKey"
                            className="flex-1 rounded-[18px] py-2 text-[14px] font-semibold text-muted-foreground data-active:bg-background/80 data-active:text-foreground data-active:shadow-[0_2px_10px_rgba(0,0,0,0.1),0_1px_1px_rgba(255,255,255,0.2)_inset]"
                        >
                            API Key
                        </TabsTrigger>
                        <TabsTrigger
                            value="credentials"
                            className="flex-1 rounded-[18px] py-2 text-[14px] font-semibold text-muted-foreground data-active:bg-background/80 data-active:text-foreground data-active:shadow-[0_2px_10px_rgba(0,0,0,0.1),0_1px_1px_rgba(255,255,255,0.2)_inset]"
                        >
                            Credentials
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="apiKey">
                        <form id="login-apiKey" onSubmit={apiKeyForm.handleSubmit(onApiKeySubmit)} noValidate>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <KeyRound className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa"
                                    aria-invalid={!!apiKeyForm.formState.errors.token}
                                    className={`${INPUT_CLASSES} font-mono`}
                                    autoFocus
                                    spellCheck={false}
                                    {...apiKeyForm.register("token")}
                                />
                            </div>
                            {apiKeyForm.formState.errors.token && (
                                <p role="alert" className="mt-2 text-sm text-destructive px-1">
                                    {apiKeyForm.formState.errors.token.message}
                                </p>
                            )}
                        </form>
                    </TabsContent>

                    <TabsContent value="credentials" className="flex flex-col gap-4">
                        <form id="login-credentials" onSubmit={credentialsForm.handleSubmit(onCredentialsSubmit)} noValidate className="flex flex-col gap-4">
                            <div>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <AtSign className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Username or Email"
                                        aria-invalid={!!credentialsForm.formState.errors.username}
                                        className={INPUT_CLASSES}
                                        autoFocus
                                        {...credentialsForm.register("username")}
                                    />
                                </div>
                                {credentialsForm.formState.errors.username && (
                                    <p role="alert" className="mt-2 text-sm text-destructive px-1">
                                        {credentialsForm.formState.errors.username.message}
                                    </p>
                                )}
                            </div>
                            <div>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <Lock className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <input
                                        type="password"
                                        placeholder="Password"
                                        aria-invalid={!!credentialsForm.formState.errors.password}
                                        className={INPUT_CLASSES}
                                        {...credentialsForm.register("password")}
                                    />
                                </div>
                                {credentialsForm.formState.errors.password && (
                                    <p role="alert" className="mt-2 text-sm text-destructive px-1">
                                        {credentialsForm.formState.errors.password.message}
                                    </p>
                                )}
                            </div>
                        </form>
                    </TabsContent>
                </Tabs>

                <label className="flex items-center gap-3 cursor-pointer group mb-8 self-start">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={rememberBot}
                        onChange={(e) => setRememberBot(e.target.checked)}
                    />
                    <div className="w-5 h-5 rounded-[6px] border border-white/20 flex items-center justify-center group-hover:border-primary/50 transition-all bg-black/5 dark:bg-white/5 shadow-[0_1px_2px_rgba(0,0,0,0.1)_inset] peer-checked:[&>*]:opacity-100">
                        <div className="w-3 h-3 bg-primary rounded-[3px] opacity-0 shadow-[0_0_8px_rgba(13,148,136,0.5)] transition-opacity" />
                    </div>
                    <span className="text-[15px] font-medium text-foreground/80 select-none">Remember this bot</span>
                </label>

                <button
                    type="submit"
                    form={loginMethod === "apiKey" ? "login-apiKey" : "login-credentials"}
                    disabled={isLoading || !activeFormIsValid}
                    className="group relative w-full h-14 rounded-full bg-linear-to-b from-primary/90 to-teal-500 text-white font-semibold text-[16px] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_8px_20px_rgba(13,148,136,0.3),0_1px_1px_rgba(255,255,255,0.4)_inset] hover:shadow-[0_12px_28px_rgba(13,148,136,0.5),0_1px_1px_rgba(255,255,255,0.5)_inset] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0 overflow-hidden backdrop-blur-md border border-black/10 dark:border-white/10"
                >
                    <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                    ) : (
                        <span className="flex items-center gap-2 relative z-10">
                            Sign In
                            <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                        </span>
                    )}
                </button>

                <div className="mt-6 text-center">
                    <p className="text-[14px] text-muted-foreground">
                        Don&apos;t have an account?{" "}
                        <Link href="/signup" className="text-primary hover:underline font-medium">
                            Sign Up
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
