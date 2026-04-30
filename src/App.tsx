import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loader2, ServerIcon, LinkIcon, MailIcon, FileUp, InfoIcon, Download, Upload, List, CheckCircle2, XCircle, Sparkles, Pause, Play, Square } from "lucide-react";
import { get, set } from "idb-keyval";
import { GoogleGenAI } from "@google/genai";

const CONFIG_STORAGE_KEY = 'hallpass_config';
const GEMINI_MODEL = 'gemini-2.5-flash';

const DEFAULT_CONFIG = {
  emailProvider: 'smtp',
  smtpPort: 587,
  emailSubject: 'Your Hall Ticket',
  emailBody: 'Dear {{STUDENT_NAME}},\n\nPlease find attached your hall ticket.\n\nBest regards.',
  statusFetch: 'Ready',
  statusSuccess: 'Sent',
  colHallTicketNo: 'Hall_TicketNo',
  colDistrict: 'DISTRICT',
  colStudentName: 'STUDENT_NAME',
  colFather: 'FATHER_NAME',
  colMother: 'MOTHER_NAME',
  colTestCentreName: 'TEST_CENTRE_NAME',
};

const REQUIRED_MAPPING_KEYS = [
  'colHallTicketNo',
  'colDistrict',
  'colStudentName',
  'colFather',
  'colMother',
  'colTestCentreName',
];

const PROFILE_CONFIG_KEYS = [
  'airtableToken',
  'airtableBaseId',
  'airtableTable',
  'statusFetch',
  'statusSuccess',
  'optGenerate',
  'optEmail',
  'colHallTicketNo',
  'colDistrict',
  'colStudentName',
  'colFather',
  'colMother',
  'colTestCentreName',
  'colTestTime',
  'colEmail',
  'colHallTicketUrl',
  'geminiApiKey',
  'googleServiceAccount',
  'googleTemplateId',
  'emailProvider',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpPass',
  'emailSubject',
  'emailBody',
];

function normalizeConfig(data: any = {}) {
  const merged: any = { ...DEFAULT_CONFIG, ...data };
  REQUIRED_MAPPING_KEYS.forEach(key => {
    if (!merged[key]) {
      merged[key] = (DEFAULT_CONFIG as any)[key];
    }
  });
  return merged;
}

function buildProfile(config: any, filterText: string) {
  const normalizedConfig = normalizeConfig(config);
  const exportedConfig = PROFILE_CONFIG_KEYS.reduce((profile: any, key) => {
    profile[key] = normalizedConfig[key] ?? '';
    return profile;
  }, {});

  return {
    profileType: 'hallpass-admin-profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: exportedConfig,
    ui: {
      dashboardFilter: filterText,
    },
  };
}

function readProfileConfig(profile: any) {
  if (profile?.profileType === 'hallpass-admin-profile' && profile.config) {
    return profile.config;
  }

  return profile;
}

async function readJsonResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('application/json')) {
    return text ? JSON.parse(text) : {};
  }

  if (text.includes('Authentication Required') || text.includes('Vercel Authentication')) {
    throw new Error('Vercel deployment protection is blocking this API request. Disable Vercel Authentication for this project or use a public production domain.');
  }

  throw new Error(`Server returned non-JSON response (${res.status}). ${text.slice(0, 120) || res.statusText}`);
}

export default function App() {
  const [config, setConfig] = useState<any>({});
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [students, setStudents] = useState<any[]>([]);
  const [isFetchingStudents, setIsFetchingStudents] = useState(false);

  const [tables, setTables] = useState<any[]>([]);
  const [isFetchingTables, setIsFetchingTables] = useState(false);

  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [processingStatus, setProcessingStatus] = useState<Record<string, { status: 'pending' | 'processing' | 'success' | 'error', error?: string }>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [logs, setLogs] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [emailPrompt, setEmailPrompt] = useState("");
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  // Flow control
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const hasLoadedConfigRef = useRef(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleGenerateEmail = async () => {
    if (!emailPrompt.trim()) {
      toast.error("Please enter a prompt describing the email.");
      return;
    }
    
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      toast.error("Gemini API key is not configured.");
      return;
    }

    setIsGeneratingEmail(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an expert copywriter. Write an email template according to the following prompt.
The template MUST include the appropriate placeholders.
Available placeholders: {{Hall_TicketNo}}, {{DISTRICT}}, {{STUDENT_NAME}}, {{FATHER_NAME}}, {{MOTHER_NAME}}, {{TEST_CENTRE_NAME}}.
Do NOT use variables other than the ones listed above.
Output ONLY the raw content of the email without markdown formatting, no headers, no closing quotes, just the plain text for the body.
Keep it professional but encouraging.

User Prompt: ${emailPrompt}`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt
      });

      if (response.text) {
        handleConfigChange("emailBody", response.text.trim());
        toast.success("AI generated the email body!");
      } else {
        throw new Error("No text returned");
      }
    } catch(err: any) {
      console.error(err);
      toast.error("Failed to generate email: " + err.message);
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  useEffect(() => {
    get(CONFIG_STORAGE_KEY)
      .then(data => {
        if (data) {
          setConfig(normalizeConfig(data));
        } else {
          setConfig(normalizeConfig());
        }
        hasLoadedConfigRef.current = true;
        setIsLoadingConfig(false);
      })
      .catch(err => {
        toast.error("Failed to load configuration");
        setConfig(normalizeConfig());
        hasLoadedConfigRef.current = true;
        setIsLoadingConfig(false);
      });
  }, []);

  useEffect(() => {
    if (!hasLoadedConfigRef.current) return;

    const saveTimer = window.setTimeout(() => {
      set(CONFIG_STORAGE_KEY, config).catch(() => {
        toast.error("Failed to auto-save configuration");
      });
    }, 400);

    return () => window.clearTimeout(saveTimer);
  }, [config]);

  const handleConfigChange = (field: string, value: any) => {
    if (field === 'airtableBaseId') {
      const match = value.match(/app[a-zA-Z0-9]{14}/);
      if (match) {
        value = match[0];
      }
    }
    if (field === 'airtableTable') {
      const match = value.match(/tbl[a-zA-Z0-9]{14}/);
      if (match) {
        value = match[0];
      }
    }
    if (field === 'googleTemplateId') {
      const match = value.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        value = match[1];
      }
    }
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const processFile = (file: File) => {
    if (file.type === "application/json" || file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          JSON.parse(text); // Verify it's valid JSON
          handleConfigChange('googleServiceAccount', text);
          toast.success("Service account JSON loaded successfully");
        } catch (err) {
          toast.error("Invalid JSON file format");
        }
      };
      reader.readAsText(file);
    } else {
      toast.error("Please provide a valid JSON file");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = ''; // Reset input
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const saveConfig = async () => {
    setIsSavingConfig(true);
    try {
      await set(CONFIG_STORAGE_KEY, config);
      toast.success("Configuration saved successfully");
    } catch (e) {
      toast.error("Error saving configuration");
    }
    setIsSavingConfig(false);
  };

  const exportConfig = () => {
    try {
      const profileJson = JSON.stringify(buildProfile(config, filterText), null, 2);
      const blob = new Blob([profileJson], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const downloadAnchorNode = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      downloadAnchorNode.href = url;
      downloadAnchorNode.download = `hallpass-profile-${timestamp}.json`;
      downloadAnchorNode.style.display = 'none';
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      URL.revokeObjectURL(url);
      toast.success("Profile export started");
    } catch (e) {
      toast.error("Error exporting profile");
    }
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const parsed = JSON.parse(text);
          const nextConfig = normalizeConfig(readProfileConfig(parsed));
          setConfig(nextConfig);
          if (parsed?.ui?.dashboardFilter !== undefined) {
            setFilterText(String(parsed.ui.dashboardFilter || ''));
          }
          set(CONFIG_STORAGE_KEY, nextConfig).catch(() => {
            toast.error("Profile loaded, but failed to save permanently.");
          });
          toast.success("Profile loaded and saved.");
        } catch (err) {
          toast.error("Invalid config profile format");
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const fetchTables = async () => {
    if (!config.airtableToken || !config.airtableBaseId) {
      toast.error('Please enter Airtable Token and Base ID first');
      return;
    }
    setIsFetchingTables(true);
    setTables([]);
    try {
      const res = await fetch('/api/airtable/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: config.airtableToken, baseId: config.airtableBaseId })
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error);
      setTables(data.tables);
      toast.success(`Found ${data.tables.length} tables.`);
    } catch (err: any) {
      toast.error(`Failed to fetch tables: ${err.message}`);
    } finally {
      setIsFetchingTables(false);
    }
  };

  const fetchStudents = async () => {
    setIsFetchingStudents(true);
    addLog(`[INFO] Fetching records from Airtable...`);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch');
      }
      setStudents(data.records);
      setSelectedStudents(new Set(data.records.map((r: any) => r.id)));
      toast.success(`Fetched ${data.records.length} students`);
      addLog(`[DEBUG] Found ${data.records.length} records`);
    } catch (e: any) {
      toast.error(e.message || "Failed to fetch students");
      addLog(`[ERROR] Fetch failed: ${e.message}`);
    }
    setIsFetchingStudents(false);
  };

  const toggleStudentSelection = (id: string) => {
    const newSelection = new Set(selectedStudents);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedStudents(newSelection);
  };

  const toggleAllStudents = () => {
    if (selectedStudents.size === filteredStudents.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const handlePause = () => {
    pauseRef.current = true;
    setIsPaused(true);
    addLog(`[SYSTEM] Processing paused`);
  };

  const handleResume = () => {
    pauseRef.current = false;
    setIsPaused(false);
    addLog(`[SYSTEM] Processing resumed`);
  };

  const handleStop = () => {
    stopRef.current = true;
    pauseRef.current = false; // unpause if paused to exit loop
    setIsPaused(false);
  };

  const processSelected = async () => {
    if (selectedStudents.size === 0) {
      toast.error("No students selected");
      return;
    }
    
    pauseRef.current = false;
    stopRef.current = false;
    setIsPaused(false);
    setIsProcessing(true);
    const selectedList = students.filter(s => selectedStudents.has(s.id));
    
    addLog(`[SYSTEM] Starting batch processing for ${selectedList.length} records`);
    
    const initialStatus: Record<string, any> = { ...processingStatus };
    selectedList.forEach(s => {
      initialStatus[s.id] = { status: 'pending' };
    });
    setProcessingStatus(initialStatus);

    for (const student of selectedList) {
      if (stopRef.current) {
        addLog(`[SYSTEM] Processing stopped by user`);
        break;
      }

      while (pauseRef.current) {
        if (stopRef.current) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (stopRef.current) {
        addLog(`[SYSTEM] Processing stopped by user`);
        break;
      }

      setProcessingStatus(prev => ({ ...prev, [student.id]: { status: 'processing' } }));
      addLog(`[TRANS] Processing: ${student.hallTicketNo || student.studentName}`);
      try {
        const res = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student, config })
        });
        const data = await readJsonResponse(res);
        if (res.ok && data.success) {
          setProcessingStatus(prev => ({ ...prev, [student.id]: { status: 'success' } }));
          addLog(`[SUCCESS] Email sent for: ${student.hallTicketNo || student.studentName}`);
        } else {
          setProcessingStatus(prev => ({ ...prev, [student.id]: { status: 'error', error: data.error } }));
          addLog(`[ERROR] Failed ${student.hallTicketNo}: ${data.error}`);
        }
      } catch (e: any) {
        setProcessingStatus(prev => ({ ...prev, [student.id]: { status: 'error', error: e.message } }));
        addLog(`[ERROR] Failed ${student.hallTicketNo}: ${e.message}`);
      }
    }
    
    setIsProcessing(false);
    setIsPaused(false);
    if (stopRef.current) {
      toast.info("Processing stopped");
    } else {
      toast.success("Processing completed");
      addLog(`[SYSTEM] Batch processing completed`);
    }
  };

  const filteredStudents = students.filter(s => 
    s.studentName?.toLowerCase().includes(filterText.toLowerCase()) || 
    s.hallTicketNo?.toLowerCase().includes(filterText.toLowerCase())
  );

  const readyCount = students.filter(s => s.status === config.statusFetch || s.status === 'Ready').length;
  const sentCount = Object.values(processingStatus).filter(s => s.status === 'success').length;
  const failedCount = Object.values(processingStatus).filter(s => s.status === 'error').length;
  const processingCount = Object.values(processingStatus).filter(s => s.status === 'processing' || s.status === 'pending').length;
  
  const progressPercent = selectedStudents.size > 0 && isProcessing
      ? Math.round(((sentCount + failedCount) / selectedStudents.size) * 100)
      : 0;

  if (isLoadingConfig) {
    return <div className="flex h-screen items-center justify-center bg-[#f0f2f5]"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f0f2f5] font-sans">
        <Toaster />
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 bg-blue-500 rounded flex items-center justify-center text-white font-bold text-xl">H</div>
            <CardTitle>HallPass Admin</CardTitle>
            <CardDescription>Enter PIN to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (pinInput === '0000') {
                setIsAuthenticated(true);
                toast.success('Authenticated successfully');
              } else {
                toast.error('Incorrect PIN');
                setPinInput('');
              }
            }}>
              <div className="space-y-4">
                <Input 
                  type="password" 
                  placeholder="Enter 4-digit PIN" 
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  className="text-center text-2xl tracking-[0.5em] font-mono h-14"
                  autoFocus
                />
                <Button type="submit" className="w-full h-12 text-lg">
                  Access Dashboard
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="flex h-screen w-full overflow-hidden bg-[#f0f2f5] font-sans text-slate-800">
      <Toaster />
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#0f172a] text-slate-300 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800 shrink-0">
          <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-white font-bold">H</div>
          <span className="font-bold tracking-tight text-white">HallPass Admin</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <div onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 rounded-md flex items-center gap-3 cursor-pointer transition-colors ${activeTab === 'dashboard' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800'}`}>
            {activeTab === 'dashboard' && <div className="w-2 h-2 rounded-full bg-blue-400"></div>}
            <span>Dashboard</span>
          </div>
          <div onClick={() => setActiveTab('config')} className={`px-4 py-2 rounded-md flex items-center gap-3 cursor-pointer transition-colors ${activeTab === 'config' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800'}`}>
            {activeTab === 'config' && <div className="w-2 h-2 rounded-full bg-blue-400"></div>}
            <span>Configuration</span>
          </div>
        </nav>
        <div className="p-4 border-t border-slate-800 shrink-0">
          <div className="text-xs uppercase text-slate-500 font-semibold mb-3">System Health</div>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="flex items-center gap-1.5"><ServerIcon className="w-3 h-3"/> Airtable API</span>
              <span className={config.airtableToken ? "text-green-400" : "text-slate-500"}>{config.airtableToken ? 'Connected' : 'Missing'}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="flex items-center gap-1.5"><LinkIcon className="w-3 h-3"/> Google Slides</span>
              <span className={config.googleServiceAccount ? "text-green-400" : "text-slate-500"}>{config.googleServiceAccount ? 'Linked' : 'Missing'}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="flex items-center gap-1.5"><MailIcon className="w-3 h-3"/> SMTP Relay</span>
              <span className={config.smtpHost ? "text-green-400" : "text-slate-500"}>{config.smtpHost ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">{activeTab === 'dashboard' ? 'Automation Dashboard' : 'Configuration Settings'}</h1>
            <div className="h-4 w-px bg-slate-300"></div>
            <span className="text-sm text-slate-500">Airtable Base: <strong className="font-mono text-xs">{config.airtableBaseId || 'Not set'}</strong></span>
          </div>
          {activeTab === 'dashboard' && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col mr-4 border-r border-slate-200 pr-4 gap-1">
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer hover:text-slate-900 transition-colors">
                  <input type="checkbox" checked={config.optGenerate !== false} onChange={e => handleConfigChange('optGenerate', e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3 h-3" />
                  ENABLE GEN & SAVE PDF
                </label>
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer hover:text-slate-900 transition-colors">
                  <input type="checkbox" checked={config.optEmail !== false} onChange={e => handleConfigChange('optEmail', e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3 h-3" />
                  ENABLE SEND EMAIL
                </label>
              </div>
              <button onClick={fetchStudents} disabled={isFetchingStudents || isProcessing} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm font-medium transition-colors disabled:opacity-50 flex items-center">
                {isFetchingStudents && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh Records
              </button>
              <button 
                onClick={() => {
                  const failedIds = Object.keys(processingStatus).filter(id => processingStatus[id].status === 'error');
                  if (failedIds.length > 0) {
                     setSelectedStudents(new Set(failedIds));
                     toast.success("Failed records selected.");
                  }
                }}
                disabled={isProcessing || failedCount === 0} 
                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-sm font-medium shadow-sm transition-colors disabled:opacity-50">
                Select Failed
              </button>
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  {!isPaused ? (
                    <button onClick={handlePause} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5">
                      <Pause className="w-4 h-4" /> Pause
                    </button>
                  ) : (
                    <button onClick={handleResume} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5">
                      <Play className="w-4 h-4" /> Resume
                    </button>
                  )}
                  <button onClick={handleStop} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5">
                    <Square className="w-4 h-4" /> Stop
                  </button>
                </div>
              ) : (
                <button onClick={processSelected} disabled={selectedStudents.size === 0 || (config.optGenerate === false && config.optEmail === false)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center">
                  <Play className="mr-2 h-4 w-4" />
                  Process ({selectedStudents.size})
                </button>
              )}
            </div>
          )}
        </header>

        {activeTab === 'dashboard' ? (
          <>
            {/* Metric Stats Section */}
            <section className="p-6 grid grid-cols-4 gap-4 shrink-0">
              <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex flex-col justify-center">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Ready to Process</div>
                <div className="text-2xl font-bold text-blue-600">{readyCount}</div>
              </div>
              <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex flex-col justify-center">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Emails Sent (Session)</div>
                <div className="text-2xl font-bold text-green-600">{sentCount}</div>
              </div>
              <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex flex-col justify-center">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Failed / Retrying</div>
                <div className="text-2xl font-bold text-red-500">{failedCount}</div>
              </div>
              <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex flex-col justify-center">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Queue Status</div>
                <div className="text-2xl font-bold text-slate-800">{processingCount > 0 ? `${processingCount} active` : 'Idle'}</div>
              </div>
            </section>

            {/* Main Content Area */}
            <div className="flex-1 px-6 pb-6 grid grid-cols-12 gap-6 min-h-0">
              {/* Records Grid */}
              <div className="col-span-8 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col min-h-0">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="font-bold text-sm">Active Processing Queue</h3>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Filter students..." 
                      className="text-xs border border-slate-200 rounded px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={filterText}
                      onChange={e => setFilterText(e.target.value)}
                    />
                  </div>
                </div>
                <div className="overflow-y-auto overflow-x-auto flex-1">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 sticky top-0 shadow-sm">
                      <tr>
                        <th className="p-3 border-b border-slate-200 w-8">
                          <input 
                            type="checkbox" 
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0} 
                            onChange={toggleAllStudents}
                            disabled={isProcessing}
                          />
                        </th>
                        <th className="p-3 border-b border-slate-200 font-semibold text-slate-600">HALL TICKET NO</th>
                        <th className="p-3 border-b border-slate-200 font-semibold text-slate-600">STUDENT NAME</th>
                        <th className="p-3 border-b border-slate-200 font-semibold text-slate-600">DISTRICT</th>
                        <th className="p-3 border-b border-slate-200 font-semibold text-slate-600">TEST TIME</th>
                        <th className="p-3 border-b border-slate-200 font-semibold text-slate-600">STATUS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">
                            {students.length === 0 ? 'No records loaded. Click "Refresh Records".' : 'No records match filter.'}
                          </td>
                        </tr>
                      ) : (
                        filteredStudents.map((student, idx) => {
                          const pObj = processingStatus[student.id];
                          let statusNode = <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full font-semibold">{student.status || 'Unknown'}</span>;
                          
                          if (pObj) {
                            if (pObj.status === 'processing') statusNode = <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> Processing...</span>;
                            else if (pObj.status === 'success') {
                              statusNode = (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="px-2 py-0.5 bg-green-100 text-green-800 border border-green-200 rounded-full font-semibold inline-flex items-center gap-1 cursor-help shadow-sm">
                                      <CheckCircle2 className="w-3 h-3" /> Sent
                                      </span>
                                    }
                                  />
                                  <TooltipContent side="top" className="bg-green-900 text-green-50 border-green-800">
                                    <p className="text-xs">Hall ticket generated, uploaded to Airtable, and email sent.</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            else if (pObj.status === 'error') {
                              statusNode = (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="px-2 py-0.5 bg-red-100 text-red-800 border border-red-200 rounded-full font-semibold inline-flex items-center gap-1 cursor-help shadow-sm">
                                      <XCircle className="w-3 h-3" /> Failed
                                      </span>
                                    }
                                  />
                                  <TooltipContent side="top" className="bg-red-900 text-red-50 border-red-800 max-w-[250px] break-words">
                                    <p className="text-xs">{pObj.error || 'An unknown error occurred.'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            else if (pObj.status === 'pending') statusNode = <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-semibold">Pending</span>;
                          } else if (student.status === config.statusSuccess || student.status === 'Sent') {
                            statusNode = (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="px-2 py-0.5 bg-green-100 text-green-800 border border-green-200 rounded-full font-semibold inline-flex items-center gap-1 cursor-help shadow-sm">
                                    <CheckCircle2 className="w-3 h-3" /> Sent
                                    </span>
                                  }
                                />
                                <TooltipContent side="top" className="bg-green-900 text-green-50 border-green-800">
                                  <p className="text-xs">Previously processed successfully.</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          } else if (student.status === config.statusFetch || student.status === 'Ready') {
                            statusNode = <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold">Ready</span>;
                          }

                          return (
                            <tr key={student.id} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-50'}>
                              <td className="p-3">
                                <input 
                                  type="checkbox"
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  checked={selectedStudents.has(student.id)} 
                                  onChange={() => toggleStudentSelection(student.id)}
                                  disabled={isProcessing}
                                />
                              </td>
                              <td className="p-3 font-mono text-blue-600">{student.hallTicketNo || '-'}</td>
                              <td className="p-3 font-medium">{student.studentName || '-'}</td>
                              <td className="p-3">{student.district || '-'}</td>
                              <td className="p-3">{student.testTime || '-'}</td>
                              <td className="p-3">{statusNode}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Logs & Configuration Preview */}
              <div className="col-span-4 flex flex-col gap-6 min-h-0">
                <div className="bg-slate-900 rounded-lg p-4 flex flex-col min-h-0 flex-1">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Live API Output</span>
                    <span className="text-[10px] text-slate-500">{logs.length} events</span>
                  </div>
                  <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1.5 whitespace-pre-wrap break-all pr-2 custom-scrollbar">
                    {logs.length === 0 ? (
                      <span className="text-slate-600">Waiting for activity...</span>
                    ) : (
                      logs.map((log, i) => {
                        let colorClass = "text-slate-300";
                        if (log.startsWith("[SUCCESS]")) colorClass = "text-green-400";
                        if (log.startsWith("[ERROR]")) colorClass = "text-red-400";
                        if (log.startsWith("[INFO]")) colorClass = "text-blue-300";
                        if (log.startsWith("[SYSTEM]")) colorClass = "text-purple-400";
                        if (log.startsWith("[TRANS]")) colorClass = "text-yellow-200";
                        if (log.startsWith("[DEBUG]")) colorClass = "text-slate-500";
                        
                        return <p key={i} className={colorClass}>{log}</p>;
                      })
                    )}
                    {isProcessing && <p className="animate-pulse text-white mt-2">_ Processing...</p>}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-4 shrink-0">
                  <h3 className="font-bold text-xs mb-3 text-slate-500">QUICK SETTINGS</h3>
                  <div className="space-y-2">
                    <div className="text-[11px]">
                      <label className="block text-slate-400 mb-1">Email Subject Template</label>
                      <div className="p-2 bg-slate-50 border border-slate-100 rounded italic text-slate-600 truncate">
                        {config.emailSubject || 'Template not set'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-4">
                      <button onClick={() => setActiveTab('config')} className="py-2 bg-slate-800 hover:bg-slate-700 text-white transition-colors rounded text-[10px] font-bold uppercase tracking-wider">Edit Template</button>
                      <button onClick={() => setActiveTab('config')} className="py-2 border border-slate-200 hover:bg-slate-50 transition-colors rounded text-[10px] font-bold uppercase tracking-wider">Config Keys</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Progress Rail */}
            {isProcessing && (
              <footer className="h-10 bg-slate-100 border-t border-slate-200 flex items-center px-6 gap-6 shrink-0 transition-all duration-300">
                <div className="text-[11px] font-medium text-slate-500 w-48 truncate">
                  Processing: <span className="text-slate-800">{sentCount + failedCount} / {selectedStudents.size} complete</span>
                </div>
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-500 ease-out" 
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <div className="text-[11px] text-slate-500 italic w-32 text-right">{progressPercent}%</div>
              </footer>
            )}
          </>
        ) : (
          /* Configuration View */
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6 pb-12">
              
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                  <h2 className="font-bold text-sm text-slate-800">Airtable Settings</h2>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Personal Access Token</Label>
                      <Input type="password" value={config.airtableToken || ''} onChange={e => handleConfigChange('airtableToken', e.target.value)} className="text-sm bg-slate-50 font-mono" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Base ID</Label>
                      <Input value={config.airtableBaseId || ''} onChange={e => handleConfigChange('airtableBaseId', e.target.value)} className="text-sm bg-slate-50 font-mono" />
                      <p className="text-[11px] text-slate-500">Paste your Base ID or a full Airtable URL to extract it.</p>
                    </div>
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <Label className="text-xs font-semibold text-slate-600">Table Name or ID</Label>
                      <div className="flex gap-2">
                        <Input value={config.airtableTable || ''} onChange={e => handleConfigChange('airtableTable', e.target.value)} className="text-sm bg-slate-50 font-mono" />
                        <Button variant="outline" type="button" onClick={fetchTables} disabled={isFetchingTables || !config.airtableToken || !config.airtableBaseId}>
                          {isFetchingTables ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <List className="w-4 h-4 mr-2" />}
                          Load Tables
                        </Button>
                      </div>
                      <p className="text-[11px] text-slate-500">Paste your Table name/ID, or load from Airtable.</p>
                      <div className="mt-2 bg-yellow-50 text-yellow-800 p-2 text-[11px] rounded border border-yellow-200">
                        <strong>Note:</strong> Ensure your Airtable table has a column exactly named <code>hall ticket URL</code> (URL type) to save the generated PDF view link.
                      </div>
                      
                      {tables.length > 0 && (
                        <div className="mt-2 p-3 bg-slate-50 rounded border border-slate-200">
                           <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-2">Available Tables</Label>
                           <div className="flex flex-wrap gap-2">
                             {tables.map(t => (
                               <button 
                                 key={t.id} 
                                 onClick={() => handleConfigChange('airtableTable', t.id)} 
                                 className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${config.airtableTable === t.id ? 'bg-blue-100 border-blue-300 text-blue-800 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                               >
                                 {t.name}
                               </button>
                             ))}
                           </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Fetch Status Filter</Label>
                      <Input value={config.statusFetch || 'Ready'} onChange={e => handleConfigChange('statusFetch', e.target.value)} className="text-sm bg-slate-50" />
                      <p className="text-[11px] text-slate-500">Only fetch records where Status matches this value</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Success Status Value</Label>
                      <Input value={config.statusSuccess || 'Sent'} onChange={e => handleConfigChange('statusSuccess', e.target.value)} className="text-sm bg-slate-50" />
                      <p className="text-[11px] text-slate-500">Update Airtable to this status after successful delivery</p>
                    </div>
                  </div>

                  {/* Field Mapping Section */}
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-sm text-slate-800">Hall Ticket Placeholder Mapping</h3>
                      <Button onClick={async () => {
                        if (!config.airtableToken || !config.airtableBaseId || !config.airtableTable) {
                          toast.error("Please select an Airtable Table first.");
                          return;
                        }
                        const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
                        if (!apiKey) {
                          toast.error("Gemini API key is not configured.");
                          return;
                        }

                        toast.loading("Reading Airtable columns & Auto-mapping...", { id: "automap" });
                        try {
                          const colsRes = await fetch('/api/airtable/columns', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ config })
                          });
                          const data = await readJsonResponse(colsRes);
                          if (data.error) throw new Error(data.error);

                          const columns = data.columns;
                          if (!columns || columns.length === 0) {
                            throw new Error("No columns found in the table. Add some data first.");
                          }

                          const ai = new GoogleGenAI({ apiKey });
                          const prompt = `You are a data mapping assistant. I have an Airtable table with these columns:
${JSON.stringify(columns)}

  I need to map Airtable columns to these Google Slides hall ticket placeholders:
- colHallTicketNo for {{Hall_TicketNo}} (hall ticket / roll number)
- colDistrict for {{DISTRICT}} (district)
- colStudentName for {{STUDENT_NAME}} (student name)
- colFather for {{FATHER_NAME}} (father name)
- colMother for {{MOTHER_NAME}} (mother name)
- colTestCentreName for {{TEST_CENTRE_NAME}} (test centre name)
- colTestTime (Date and Time of the test)
- colEmail (Email Address)
- colHallTicketUrl (Column to write the generated PDF URL back to)

Respond ONLY with a valid JSON object where keys are my field names and values are the exact matching Airtable column names. If no logical match is found, map it to "". DO NOT use Markdown formatting \`\`\`json... just the raw curly braces JSON object.`;

                          const response = await ai.models.generateContent({
                            model: GEMINI_MODEL,
                            contents: prompt
                          });

                          if (response.text) {
                            let jsonStr = response.text.trim();
                            if (jsonStr.startsWith('\`\`\`json')) {
                                jsonStr = jsonStr.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
                            } else if (jsonStr.startsWith('\`\`\`')) {
                                jsonStr = jsonStr.replace(/\`\`\`/g, '');
                            }
                            const mapping = JSON.parse(jsonStr);
                            
                            const newConfig = { ...config };
                            let updatedCount = 0;
                            for (const [key, value] of Object.entries(mapping)) {
                              if (value && columns.includes(value as string)) {
                                 newConfig[key] = value;
                                 updatedCount++;
                              }
                            }
                            setConfig(newConfig);
                            toast.success(`Successfully mapped ${updatedCount} columns!`, { id: "automap" });
                          } else {
                            throw new Error("No mapping returned.");
                          }
                        } catch (err: any) {
                          toast.error(err.message, { id: "automap" });
                        }
                      }} variant="secondary" className="h-8 text-xs bg-indigo-600 text-white hover:bg-indigo-700 gap-1">
                        <Sparkles className="w-3 h-3" />
                        AI Auto-Map
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { key: 'colHallTicketNo', label: '{{Hall_TicketNo}}', default: 'Hall_TicketNo' },
                        { key: 'colDistrict', label: '{{DISTRICT}}', default: 'DISTRICT' },
                        { key: 'colStudentName', label: '{{STUDENT_NAME}}', default: 'STUDENT_NAME' },
                        { key: 'colFather', label: '{{FATHER_NAME}}', default: 'FATHER_NAME' },
                        { key: 'colMother', label: '{{MOTHER_NAME}}', default: 'MOTHER_NAME' },
                        { key: 'colTestCentreName', label: '{{TEST_CENTRE_NAME}}', default: 'TEST_CENTRE_NAME' },
                        { key: 'colTestTime', label: 'Test Time', default: 'Date and Time' },
                        { key: 'colEmail', label: 'Email', default: 'EMAIL' },
                        { key: 'colHallTicketUrl', label: 'Hall Ticket Link output', default: 'Hall Ticket URL' }
                      ].map(field => (
                        <div key={field.key} className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-600">{field.label}</Label>
                          <Input 
                            value={config[field.key] || ''} 
                            placeholder={field.default}
                            onChange={e => handleConfigChange(field.key, e.target.value)} 
                            className="text-sm bg-slate-50" 
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 bg-purple-50/50 rounded-lg border border-purple-100 shadow-sm p-4 space-y-2">
                    <h3 className="font-bold text-sm text-purple-900 flex items-center gap-1.5">
                      <InfoIcon className="w-4 h-4" /> 
                      Airtable OAuth Redirect URLs
                    </h3>
                    <p className="text-xs text-purple-800">
                      If you are configuring an Airtable OAuth integration, users will be redirected to one of these URLs after authorizing your integration:
                    </p>
                    <div className="space-y-2 mt-2">
                      <div>
                        <span className="block text-[11px] font-semibold text-purple-900 mb-0.5">OAuth Redirect URL:</span>
                        <code className="text-[11px] bg-white border border-purple-200 px-2 py-1 rounded text-purple-700 select-all block overflow-x-auto">
                          {typeof window !== 'undefined' ? window.location.origin : 'https://my-google-ai-studio-applet-1020363065274.us-west1.run.app'}/auth/callback
                        </code>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

	              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
	                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
	                  <h2 className="font-bold text-sm text-slate-800">Google API Integration</h2>
	                </div>
	                <div className="p-5 space-y-5">
	                  <div className="space-y-1.5">
	                    <Label className="text-xs font-semibold text-slate-600">Gemini API Key</Label>
	                    <Input
	                      type="password"
	                      value={config.geminiApiKey || ''}
	                      onChange={e => handleConfigChange('geminiApiKey', e.target.value)}
	                      className="text-sm bg-slate-50 font-mono"
	                      placeholder="AIza..."
	                    />
	                    <p className="text-[11px] text-slate-500">Saved locally and used for AI Auto-Map and AI Email Generator with {GEMINI_MODEL}.</p>
	                  </div>
	                  <div className="space-y-1.5">
	                    <Label className="text-xs font-semibold text-slate-600">Google Service Account JSON for Slides Access</Label>
                    <div 
                      className={`relative border-2 rounded-lg transition-colors ${
                        isDragging ? 'border-blue-500 bg-blue-50' : 'border-transparent'
                      }`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <Textarea 
                        rows={6} 
                        className={`text-xs font-mono resize-none pr-12 transition-colors ${
                          isDragging ? 'bg-transparent border-transparent text-transparent placeholder-transparent' : 'bg-slate-50'
                        }`} 
                        value={config.googleServiceAccount || ''} 
                        onChange={e => handleConfigChange('googleServiceAccount', e.target.value)} 
                        placeholder={isDragging ? 'Drop JSON file here' : '{ "type": "service_account", ... }'} 
                      />
                      {!isDragging && (
                        <div className="absolute top-2 right-2 flex flex-col gap-2">
                          <input 
                            type="file" 
                            accept="application/json" 
                            onChange={handleFileUpload} 
                            className="hidden" 
                            id="json-upload" 
                          />
                          <label htmlFor="json-upload" className="cursor-pointer p-2 bg-slate-200 hover:bg-slate-300 rounded transition-colors" title="Upload JSON File">
                            <FileUp className="w-4 h-4 text-slate-600" />
                          </label>
                        </div>
                      )}
                      {isDragging && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <p className="text-blue-500 font-medium font-sans">Drop JSON file here</p>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">Used only to access the Google Slides template. The hall ticket uses only the mapped placeholders.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Google Slides Template ID</Label>
                    <Input value={config.googleTemplateId || ''} onChange={e => handleConfigChange('googleTemplateId', e.target.value)} className="text-sm bg-slate-50 font-mono" />
                    <p className="text-[11px] text-slate-500">Must be shared with the Service Account email with 'Editor' permissions.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                  <h2 className="font-bold text-sm text-slate-800">SMTP Email Configuration</h2>
                </div>
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">SMTP Host</Label>
                      <Input value={config.smtpHost || ''} onChange={e => handleConfigChange('smtpHost', e.target.value)} className="text-sm bg-slate-50 font-mono" placeholder="smtp.gmail.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">SMTP Port</Label>
                      <Input value={config.smtpPort || ''} onChange={e => handleConfigChange('smtpPort', e.target.value)} className="text-sm bg-slate-50 font-mono" placeholder="587" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">SMTP User Email</Label>
                      <Input value={config.smtpUser || ''} onChange={e => handleConfigChange('smtpUser', e.target.value)} className="text-sm bg-slate-50 font-mono" placeholder="admin@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">SMTP Password</Label>
                      <Input type="password" value={config.smtpPass || ''} onChange={e => handleConfigChange('smtpPass', e.target.value)} className="text-sm bg-slate-50 font-mono" />
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-100 space-y-5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Email Subject Line</Label>
                      <Input value={config.emailSubject || ''} onChange={e => handleConfigChange('emailSubject', e.target.value)} className="text-sm bg-slate-50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Email Body Template</Label>
                      <Textarea rows={6} value={config.emailBody || ''} onChange={e => handleConfigChange('emailBody', e.target.value)} className="text-sm bg-slate-50 resize-y" />
                      <p className="text-[11px] text-slate-500">
                        Supports variables: <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{Hall_TicketNo}}"}</code>, <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{DISTRICT}}"}</code>, <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{STUDENT_NAME}}"}</code>, <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{FATHER_NAME}}"}</code>, <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{MOTHER_NAME}}"}</code>, <code className="px-1 py-0.5 bg-slate-100 rounded text-purple-600">{"{{TEST_CENTRE_NAME}}"}</code>
                      </p>
                      
                      {/* AI Email Generator block */}
                      <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-md shadow-sm space-y-2">
                        <div className="flex items-center gap-1.5 text-indigo-700 font-semibold text-xs">
                          <Sparkles className="w-4 h-4" />
                          <span>AI Email Generator</span>
                        </div>
                        <p className="text-[11px] text-indigo-600 leading-tight">
                          Describe the email you want to send and let AI draft it for you.
                        </p>
                        <div className="flex items-center gap-2">
                          <Input 
                            placeholder="e.g. A formal notice to carry ID along with the ticket..." 
                            value={emailPrompt} 
                            onChange={e => setEmailPrompt(e.target.value)} 
                            className="h-8 text-xs bg-white"
                          />
                          <Button 
                            onClick={handleGenerateEmail} 
                            disabled={isGeneratingEmail}
                            variant="secondary"
                            className="h-8 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 gap-1"
                          >
                            {isGeneratingEmail ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3" />}
                            Auto-draft
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                  <div className="flex gap-2">
                    <input 
                      type="file" 
                      accept=".json" 
                      onChange={importConfig} 
                      className="hidden" 
                      id="config-upload" 
                    />
                    <label htmlFor="config-upload" className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-white rounded text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm text-slate-700">
                      <Upload className="w-4 h-4 mr-2 text-slate-500" />
                      Import Profile
                    </label>
                    <button onClick={exportConfig} className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-white rounded text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm text-slate-700">
                      <Download className="w-4 h-4 mr-2 text-slate-500" />
                      Export Profile
                    </button>
                  </div>
                  <Button onClick={saveConfig} disabled={isSavingConfig} className="bg-blue-600 hover:bg-blue-700 text-white px-8">
                    {isSavingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save All Changes
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50/50 rounded-lg border border-blue-100 shadow-sm p-4 space-y-2">
                <h3 className="font-bold text-sm text-blue-900 flex items-center gap-1.5">
                  <InfoIcon className="w-4 h-4" /> 
                  Configuring Google OAuth 2.0 Web Client ID
                </h3>
                <p className="text-xs text-blue-800">
                  If you are configuring OAuth 2.0 credentials in the Google Cloud Console, use the following URIs:
                </p>
                <div className="space-y-2 mt-2">
                  <div>
                    <span className="block text-[11px] font-semibold text-blue-900 mb-0.5">Authorized JavaScript Origins:</span>
                    <code className="text-[11px] bg-white border border-blue-200 px-2 py-1 rounded text-blue-700 select-all block overflow-x-auto">
                      {typeof window !== 'undefined' ? window.location.origin : 'https://my-google-ai-studio-applet-1020363065274.us-west1.run.app'}
                    </code>
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-blue-900 mb-0.5">Authorized Redirect URIs:</span>
                    <code className="text-[11px] bg-white border border-blue-200 px-2 py-1 rounded text-blue-700 select-all block overflow-x-auto">
                      {typeof window !== 'undefined' ? window.location.origin : 'https://my-google-ai-studio-applet-1020363065274.us-west1.run.app'}/auth/callback
                    </code>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </main>
      
      {/* Custom Styles for minimal scrollbar in logs */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(51, 65, 85, 0.8);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 1);
        }
      `}} />
    </div>
    </TooltipProvider>
  );
}
