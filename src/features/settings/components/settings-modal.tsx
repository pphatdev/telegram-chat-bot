import { Shield, X, User, Bell, Palette, ArrowLeft, Sun, Moon, Monitor, Check, Type, ChevronRight, Bot, Lock, LogOut, Plus, Smartphone, KeyRound, ShieldCheck, Camera, Copy, Users, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addAllowlistEntry,
  loadAllowlist,
  removeAllowlistEntry,
} from "@/features/settings/actions";
import { logout } from "@/features/auth/actions";
import type { AllowlistEntryRow } from "@/db/schema";
import type { AllowlistListType } from "@/features/settings/queries";

interface SettingsModalProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  initialView?: string;
  theme: 'light' | 'dark' | 'system';
  handleThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  font: 'inter' | 'geist' | 'kantumruy' | 'opensans' | 'sans-serif';
  handleFontChange: (font: 'inter' | 'geist' | 'kantumruy' | 'opensans' | 'sans-serif') => void;
  scale: number;
  handleScaleChange: (scale: number) => void;
}

export function SettingsModal({
  showSettings,
  setShowSettings,
  initialView,
  theme,
  handleThemeChange,
  font,
  handleFontChange,
  scale,
  handleScaleChange
}: SettingsModalProps) {
  const [viewHistory, setViewHistory] = useState<string[]>(['main']);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const activeSettingsView = viewHistory[viewHistory.length - 1];
  
  const navigateTo = (view: string) => {
    setDirection('forward');
    setViewHistory(prev => [...prev, view]);
  };
  
  const goBack = () => {
    setDirection('backward');
    setViewHistory(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  };

  const [isPasscodeOn, setIsPasscodeOn] = useState(false);
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [botName, setBotName] = useState('Kfe Meetup Security Bot');
  const [botDescription, setBotDescription] = useState('Security bot for Kfe Meetup events.');
  const [messagePreview, setMessagePreview] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  
  const [accessListTab, setAccessListTab] = useState<'whitelist' | 'blacklist' | 'keywords' | 'stickers'>('whitelist');
  const [allowlist, setAllowlist] = useState<AllowlistEntryRow[]>([]);
  const [allowlistLoaded, setAllowlistLoaded] = useState(false);
  const [allowlistSaving, setAllowlistSaving] = useState(false);
  const [newUserInput, setNewUserInput] = useState('');

  /**
   * UI tabs are plural for display; the DB column stores singular. Keep the
   * mapping local so the rest of the file can stay tab-centric.
   */
  const uiTabToDbType = (tab: typeof accessListTab): AllowlistListType => (
    tab === 'keywords' ? 'keyword' :
    tab === 'stickers' ? 'sticker' : tab
  );

  const currentDbType = uiTabToDbType(accessListTab);
  const currentEntries = allowlist.filter((e) => e.listType === currentDbType);

  const handleAddUser = async () => {
    const value = newUserInput.trim();
    if (!value || allowlistSaving) return;
    setAllowlistSaving(true);
    const result = await addAllowlistEntry(currentDbType, value);
    setAllowlistSaving(false);
    if (result.ok) {
      setAllowlist((prev) => [...prev, result.data]);
      setNewUserInput('');
    } else {
      toast.error(result.error);
    }
  };

  const handleRemoveUser = async (entry: AllowlistEntryRow) => {
    const snapshot = allowlist;
    setAllowlist((prev) => prev.filter((e) => e.id !== entry.id));
    const result = await removeAllowlistEntry(entry.id);
    if (!result.ok) {
      setAllowlist(snapshot);
      toast.error(result.error);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewHistory.length > 1) {
          goBack();
        } else if (showSettings) {
          setShowSettings(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewHistory, showSettings, setShowSettings]);

  useEffect(() => {
    if (showSettings) {
      setViewHistory(initialView ? ['main', initialView] : ['main']);
      setDirection('forward');
    }
  }, [showSettings, initialView]);

  useEffect(() => {
    if (!showSettings || allowlistLoaded) return;
    (async () => {
      const result = await loadAllowlist();
      if (result.ok) {
        setAllowlist(result.data);
        setAllowlistLoaded(true);
      } else {
        toast.error(result.error);
      }
    })();
  }, [showSettings, allowlistLoaded]);

  if (!showSettings) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background/80 backdrop-blur-3xl animate-in fade-in slide-in-from-left-8 duration-300" onClick={(e) => e.stopPropagation()}>
      <div className="flex-1 w-full p-4 sm:p-5 overflow-y-auto no-scrollbar pb-10">
        <div key={activeSettingsView} className={`w-full ${direction === 'forward' && activeSettingsView !== 'main' ? 'animate-in fade-in slide-in-from-right-8 duration-300' : ''} ${direction === 'backward' ? 'animate-in fade-in slide-in-from-left-8 duration-300' : ''}`}>
        {activeSettingsView === 'main' ? (
          <>
            <div className="relative flex items-center justify-center mb-6 h-8">
              <h2 className="text-[16px] font-semibold tracking-tight">Settings</h2>
              <button onClick={() => { setShowSettings(false); setViewHistory(['main']); setDirection('forward'); }} className="absolute right-0 rounded-full bg-black/5 dark:bg-white/5 p-1.5 hover:bg-black/10 dark:hover:bg-white/10 text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex flex-col items-center justify-center mb-6">
              <div className="relative mb-3">
                <div className="grid size-22.5 place-items-center rounded-full bg-blue-500 text-[32px] font-bold text-white shadow-xl">
                  MB
                </div>
                <div className="absolute bottom-1 right-1 size-5.5 rounded-full bg-green-500 border-[3.5px] border-background">
                </div>
              </div>
              <h3 className="text-[22px] font-bold text-foreground tracking-tight">{botName}</h3>
              <p className="text-[15px] text-muted-foreground mt-0.5">@KfeSecurityBot</p>
            </div>
            
            <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
              <button onClick={() => navigateTo('profile')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                <div className="bg-blue-500 p-1 rounded-lg text-white shadow-sm"><Bot className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Bot Profile</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
              <button onClick={() => navigateTo('security')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                <div className="bg-emerald-500 p-1 rounded-lg text-white shadow-sm"><Shield className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Privacy & Security</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
              <button onClick={() => navigateTo('passcode')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                <div className="bg-slate-700 dark:bg-slate-400 p-1 rounded-lg text-white shadow-sm"><Lock className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Passcode Lock</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
              <button onClick={() => navigateTo('notifications')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                <div className="bg-red-500 p-1 rounded-lg text-white shadow-sm"><Bell className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Notifications</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
              <button onClick={() => navigateTo('access-control')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                <div className="bg-sky-500 p-1 rounded-lg text-white shadow-sm"><Users className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Access Control</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
              <button onClick={() => navigateTo('appearance')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors">
                <div className="bg-indigo-500 p-1 rounded-lg text-white shadow-sm"><Palette className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Appearance</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
            </div>

            <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm mt-4">
              <button onClick={() => navigateTo('switch-bot')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors">
                <div className="bg-orange-500 p-1 rounded-lg text-white shadow-sm"><Bot className="w-4.5 h-4.5" /></div>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-foreground">Switch Account (Bot)</div>
                </div>
                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/50" />
              </button>
            </div>

            <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm mt-4">
              <button
                onClick={async () => {
                  await logout();
                  window.location.href = '/login';
                }}
                className="flex w-full items-center justify-center gap-2 px-4 py-3 hover:bg-destructive/10 transition-colors group"
              >
                <LogOut className="w-4.5 h-4.5 text-red-500 group-hover:text-red-600 transition-colors" />
                <div className="text-[14px] font-medium text-red-500 group-hover:text-red-600 transition-colors">Log Out</div>
              </button>
            </div>
          </>
        ) : activeSettingsView === 'profile' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Bot Profile</h2>
            </div>
            
            <div className="space-y-6">
              <div className="flex justify-center mb-2 animate-in zoom-in-95 duration-300">
                <div className="relative group cursor-pointer">
                  <div className="grid size-27.5 place-items-center rounded-full bg-blue-500 text-[40px] font-bold text-white shadow-xl transition-transform group-active:scale-95">
                    MB
                  </div>
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera className="w-9 h-9 text-white" />
                  </div>
                  <div className="absolute bottom-0 right-1 grid size-8.5 place-items-center rounded-full bg-primary text-primary-foreground border-[3.5px] border-background shadow-sm">
                    <Camera className="w-4.5 h-4.5" />
                  </div>
                </div>
              </div>

              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                <div className="p-4 border-b border-border/50 focus-within:bg-accent/30 transition-colors">
                  <div className="text-[13px] font-semibold text-primary mb-1">Name</div>
                  <input className="w-full bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50" value={botName} onChange={(e) => setBotName(e.target.value)} />
                </div>
                <div className="p-4 border-b border-border/50">
                  <div className="text-[13px] font-semibold text-primary mb-1">Username</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-foreground">@KfeSecurityBot</span>
                    <button className="text-primary hover:opacity-80 transition-opacity p-1 rounded-md hover:bg-primary/10"><Copy className="w-4.5 h-4.5" /></button>
                  </div>
                  <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">This is your bot's public handle. Users can interact with your bot by searching for this username on Telegram.</p>
                </div>
                <div className="p-4 focus-within:bg-accent/30 transition-colors">
                  <div className="text-[13px] font-semibold text-primary mb-1">About</div>
                  <textarea className="w-full bg-transparent text-[15px] text-foreground outline-none resize-none placeholder:text-muted-foreground/50 leading-relaxed" rows={2} value={botDescription} onChange={(e) => setBotDescription(e.target.value)}></textarea>
                  <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">This text will be shown on the bot's profile page and when users share your bot.</p>
                </div>
              </div>
            </div>
          </>
        ) : activeSettingsView === 'notifications' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Notifications</h2>
            </div>
            
            <div className="space-y-6">
              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                <div className="flex w-full items-center justify-between px-4 py-3.5 border-b border-border/50">
                  <div className="text-[15px] font-medium text-foreground">Desktop Notifications</div>
                  <Switch
                    checked={desktopNotifications}
                    onCheckedChange={setDesktopNotifications}
                  />
                </div>
                <div className="flex w-full items-center justify-between px-4 py-3.5 border-b border-border/50">
                  <div className="text-[15px] font-medium text-foreground">Message Preview</div>
                  <Switch
                    checked={messagePreview}
                    onCheckedChange={setMessagePreview}
                  />
                </div>
                <div className="flex w-full items-center justify-between px-4 py-3.5">
                  <div className="text-[15px] font-medium text-foreground">Play Sound</div>
                  <Switch
                    checked={soundEnabled}
                    onCheckedChange={setSoundEnabled}
                  />
                </div>
              </div>
              
              <div className="text-[13px] text-muted-foreground px-2 leading-relaxed">
                Choose how you want to be notified about new messages and events from this bot.
              </div>
            </div>
          </>
        ) : activeSettingsView === 'access-control' ? (
          <>
            <div className="relative flex items-center justify-center mb-6 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Access Control</h2>
            </div>
            
            <div className="space-y-6">
              <Tabs
                value={accessListTab}
                onValueChange={(v) => setAccessListTab(v as typeof accessListTab)}
                className="w-full"
              >
                <TabsList className="w-full h-auto bg-card/60 backdrop-blur-xl rounded-[24px] border border-white/5 shadow-sm p-1.5 gap-1 overflow-x-auto">
                  <TabsTrigger
                    value="whitelist"
                    className="flex-none rounded-[18px] px-4 py-2 text-[14px] font-medium text-muted-foreground data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm"
                  >
                    Whitelist
                  </TabsTrigger>
                  <TabsTrigger
                    value="blacklist"
                    className="flex-none rounded-[18px] px-4 py-2 text-[14px] font-medium text-muted-foreground data-active:bg-destructive data-active:text-destructive-foreground data-active:shadow-sm"
                  >
                    Blacklist
                  </TabsTrigger>
                  <TabsTrigger
                    value="keywords"
                    className="flex-none rounded-[18px] px-4 py-2 text-[14px] font-medium text-muted-foreground data-active:bg-orange-500 data-active:text-white data-active:shadow-sm"
                  >
                    Keywords
                  </TabsTrigger>
                  <TabsTrigger
                    value="stickers"
                    className="flex-none rounded-[18px] px-4 py-2 text-[14px] font-medium text-muted-foreground data-active:bg-purple-500 data-active:text-white data-active:shadow-sm"
                  >
                    Stickers
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm p-2 flex gap-2">
                <input 
                  type="text"
                  placeholder={accessListTab === 'whitelist' || accessListTab === 'blacklist' ? "Enter User ID or @username" : accessListTab === 'keywords' ? "Enter word, phrase, or /regex/ to ban" : "Enter sticker ID to ban"}
                  value={newUserInput}
                  onChange={(e) => setNewUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
                  className="flex-1 bg-transparent px-3 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/50"
                />
                <button 
                  onClick={handleAddUser}
                  disabled={!newUserInput.trim() || allowlistSaving}
                  className="bg-primary text-primary-foreground px-4 rounded-xl font-medium text-[14px] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                {!allowlistLoaded ? (
                  <div className="p-8 text-center text-muted-foreground text-[14px]">Loading…</div>
                ) : currentEntries.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-[14px]">
                    This list is currently empty.
                  </div>
                ) : (
                  currentEntries.map((entry, idx, arr) => (
                    <div key={entry.id} className={`flex items-center justify-between p-4 ${idx !== arr.length - 1 ? 'border-b border-border/50' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className={`grid size-10 place-items-center rounded-full text-white shadow-sm font-medium ${accessListTab === 'whitelist' ? 'bg-green-500' : accessListTab === 'blacklist' ? 'bg-red-500' : accessListTab === 'keywords' ? 'bg-orange-500' : 'bg-purple-500'}`}>
                          {entry.value.startsWith('@') ? entry.value.charAt(1).toUpperCase() : entry.value.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-[15px] font-medium text-foreground truncate max-w-50">{entry.value}</div>
                          {accessListTab === 'keywords' && entry.value.startsWith('/') && (
                            <span className="bg-orange-500/10 text-orange-500 border border-orange-500/20 text-[10px] font-bold px-2 py-0.5 rounded-[6px]">REGEX</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleRemoveUser(entry)} className="text-muted-foreground hover:text-destructive transition-colors p-2 hover:bg-destructive/10 rounded-full" aria-label={`Remove ${entry.value}`}>
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              
              <div className="text-[13px] text-muted-foreground px-2 leading-relaxed">
                {accessListTab === 'whitelist' 
                  ? "Users in the whitelist bypass spam filters and broadcast rate limits." 
                  : accessListTab === 'blacklist' 
                  ? "Users in the blacklist are blocked from receiving broadcasts and interacting with the bot."
                  : accessListTab === 'keywords'
                  ? "Messages containing these keywords will be automatically deleted or flagged."
                  : "Stickers matching these IDs will be automatically removed from chats."}
              </div>
            </div>
          </>
        ) : activeSettingsView === 'appearance' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Appearance</h2>
            </div>
            
            <div className="space-y-6">
              <div>
                <div className="text-[13px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 px-3">Theme</div>
                <div role="tablist" className="flex bg-secondary/50 rounded-xl p-1 border border-white/5">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={theme === t}
                      onClick={() => handleThemeChange(t)}
                      className={`flex-1 flex flex-col items-center justify-center gap-1.5 rounded-[9px] py-2.5 text-[12px] font-medium transition-all ${
                        theme === t
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent/30'
                      }`}
                    >
                      {t === 'light' && <Sun className="w-5 h-5 mb-0.5" />}
                      {t === 'dark' && <Moon className="w-5 h-5 mb-0.5" />}
                      {t === 'system' && <Monitor className="w-5 h-5 mb-0.5" />}
                      <span className="capitalize">{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[13px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 px-3">Font Family</div>
                <Select
                  value={font}
                  onValueChange={(v) => handleFontChange(v as typeof font)}
                >
                  <SelectTrigger className="w-full h-auto rounded-2xl bg-card/60 backdrop-blur-xl border border-white/5 px-4 py-3.5 text-[15px] font-medium shadow-sm">
                    <div className="flex items-center gap-3">
                      <Type className="w-4 h-4 text-muted-foreground" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border border-white/10 bg-background/95 backdrop-blur-3xl">
                    <SelectItem value="inter"><span style={{ fontFamily: 'Inter, sans-serif' }}>Inter (Default)</span></SelectItem>
                    <SelectItem value="geist"><span style={{ fontFamily: 'var(--font-geist-sans)' }}>Geist Sans</span></SelectItem>
                    <SelectItem value="kantumruy"><span style={{ fontFamily: 'var(--font-kantumruy-pro)' }}>Kantumruy Pro</span></SelectItem>
                    <SelectItem value="opensans"><span style={{ fontFamily: 'var(--font-open-sans)' }}>Open Sans</span></SelectItem>
                    <SelectItem value="sans-serif"><span style={{ fontFamily: 'sans-serif' }}>Sans Serif</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 px-3">
                  <div className="text-[13px] uppercase tracking-wider font-semibold text-muted-foreground">Display Scale: {scale}%</div>
                  {scale !== 100 && (
                    <button 
                      onClick={() => handleScaleChange(100)} 
                      className="text-[13px] text-primary hover:opacity-80 font-medium transition-opacity"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="bg-card/60 backdrop-blur-xl rounded-[24px] border border-white/5 p-5 shadow-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-[12px] font-bold text-muted-foreground">A</span>
                    <Slider
                      className="flex-1"
                      min={0}
                      max={9}
                      step={1}
                      value={(() => {
                        const steps = [65, 70, 75, 80, 85, 90, 95, 100, 110, 120];
                        const i = steps.indexOf(scale);
                        return [i === -1 ? 7 : i];
                      })()}
                      onValueChange={(vals) => {
                        const steps = [65, 70, 75, 80, 85, 90, 95, 100, 110, 120];
                        const idx = Array.isArray(vals) ? vals[0] : vals;
                        handleScaleChange(steps[idx]);
                      }}
                    />
                    <span className="text-lg font-bold text-muted-foreground">A</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-semibold text-muted-foreground/50 mt-4 px-1">
                    {[65, 70, 75, 80, 85, 90, 95, 100, 110, 120].map((step) => (
                      <span
                        key={step}
                        className={`cursor-pointer hover:text-foreground transition ${scale === step ? 'text-foreground' : ''}`}
                        onClick={() => handleScaleChange(step)}
                      >
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : activeSettingsView === 'passcode' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Passcode Lock</h2>
            </div>
            
            <div className="space-y-6">
              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                <div className="flex w-full items-center justify-between px-4 py-3.5">
                  <div className="text-[15px] font-medium text-foreground">Turn Passcode On</div>
                  <Switch
                    checked={isPasscodeOn}
                    onCheckedChange={setIsPasscodeOn}
                  />
                </div>
                {isPasscodeOn && (
                  <div className="animate-in slide-in-from-top-2 fade-in duration-200">
                    <div className="h-px w-full bg-border/50" />
                    <button className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">
                      <div className="text-[15px] font-medium text-primary">Change Passcode</div>
                    </button>
                    <div className="h-px w-full bg-border/50" />
                    <button className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">
                      <div className="text-[15px] font-medium text-foreground">Auto-Lock</div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="text-[15px]">1 hr</span>
                        <ChevronRight className="w-5 h-5 opacity-50" />
                      </div>
                    </button>
                    <div className="h-px w-full bg-border/50" />
                    <div className="flex w-full items-center justify-between px-4 py-3.5">
                      <div className="text-[15px] font-medium text-foreground">Unlock with Biometrics</div>
                      <Switch
                        checked={useBiometrics}
                        onCheckedChange={setUseBiometrics}
                      />
                    </div>
                  </div>
                )}
              </div>
              
              {isPasscodeOn && (
                <p className="text-[13px] text-muted-foreground px-4 text-center animate-in fade-in duration-300">
                  When a passcode is set, a lock icon appears at the top of your chats list. Tap it to lock your app.
                </p>
              )}
            </div>
          </>
        ) : activeSettingsView === 'switch-bot' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Switch Account</h2>
            </div>
            
            <div className="space-y-6">
              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                  <div className="relative">
                    <div className="grid size-10 place-items-center rounded-full bg-blue-500 text-sm font-semibold text-white shadow-sm">MB</div>
                    <div className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-green-500 border-2 border-background">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Marketing Bot</div>
                    <div className="text-[13px] text-muted-foreground">@KfeSecurityBot</div>
                  </div>
                </button>
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                  <div className="grid size-10 place-items-center rounded-full bg-emerald-500 text-sm font-semibold text-white shadow-sm">SB</div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Support Bot</div>
                    <div className="text-[13px] text-muted-foreground">@customer_support_bot</div>
                  </div>
                </button>
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">
                  <div className="grid size-10 place-items-center rounded-full bg-secondary text-primary shadow-sm border border-border"><Plus className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-primary">Add Bot Account</div>
                  </div>
                </button>
              </div>
              <p className="text-[13px] text-muted-foreground px-4 text-center animate-in fade-in duration-300">
                You can manage multiple bot accounts and seamlessly switch between them to manage broadcasts and settings.
              </p>
            </div>
          </>
        ) : activeSettingsView === 'security' ? (
          <>
            <div className="relative flex items-center justify-center mb-8 h-8">
              <button onClick={goBack} className="absolute left-0 flex items-center gap-1 text-primary hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-6 h-6 -ml-1" />
                <span className="text-[15px]">Settings</span>
              </button>
              <h2 className="text-[15px] font-semibold tracking-tight">Privacy & Security</h2>
            </div>
            
            <div className="space-y-6">
              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm">
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                  <div className="bg-indigo-500 p-1.5 rounded-[10px] text-white shadow-sm"><KeyRound className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Two-Step Verification</div>
                  </div>
                  <div className="text-[15px] text-muted-foreground mr-1">Off</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/50" />
                </button>
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors border-b border-border/50">
                  <div className="bg-sky-500 p-1.5 rounded-[10px] text-white shadow-sm"><Smartphone className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Active Sessions</div>
                  </div>
                  <div className="text-[15px] text-muted-foreground mr-1">2 devices</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/50" />
                </button>
                <button onClick={() => navigateTo('passcode')} className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">
                  <div className="bg-slate-700 dark:bg-slate-400 p-1.5 rounded-[10px] text-white shadow-sm"><Lock className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Passcode Lock</div>
                  </div>
                  <div className="text-[15px] text-muted-foreground mr-1">{isPasscodeOn ? 'On' : 'Off'}</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/50" />
                </button>
              </div>

              <div className="bg-card/60 backdrop-blur-xl rounded-[24px] overflow-hidden border border-white/5 shadow-sm mt-4">
                <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">
                  <div className="bg-rose-500 p-1.5 rounded-[10px] text-white shadow-sm"><ShieldCheck className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-foreground">Webhook Security</div>
                  </div>
                  <div className="text-[15px] text-muted-foreground mr-1">Active</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/50" />
                </button>
              </div>
              
              <p className="text-[13px] text-muted-foreground px-4 text-center animate-in fade-in duration-300">
                Manage your active sessions, set up two-step verification, and configure bot webhook secrets to protect against unauthorized access.
              </p>
            </div>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );
}
