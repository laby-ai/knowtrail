'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type {
  Paper,
  ProjectFolder,
  ChatMessage,
  Report,
  RichTextBlock,
  AcademicImage,
  BilingualText,
  PPTSlide,
  HighlightConfig,
  InteractionStats,
  ProjectStats,
  AudioConfig,
  VoiceClone,
  EditorMode,
  StudioFeature,
  CitationFormat,
  RuntimeAIConfig,
  StudioPromptRequest,
  VirtualClassroomViewer,
  KnowledgeMapViewer,
  Citation,
} from '@/types';
import {
  chatHistoryStorageKey,
  parseStoredChatHistory,
  serializeChatHistory,
} from '@/lib/chat-generation-lifecycle';

export type CitationReveal = Pick<Citation, 'chunkId' | 'chunkIndex' | 'page' | 'excerpt' | 'sourceTitle' | 'paperShortName'>;

export interface RevealPaperRequest {
  paperId: string;
  token: number;
  citation?: CitationReveal;
}

// 应用状态接口
interface AppState {
  storageScopeKey: string;

  // 左侧文献库
  folders: ProjectFolder[];
  selectedPapers: string[];
  activeFolderId: string | null;

  // 中间编辑器
  editorMode: EditorMode;
  chatMessages: ChatMessage[];
  currentReport: Report | null;

  // 右侧Studio
  activeStudioFeature: StudioFeature | null;
  queuedStudioPrompt: StudioPromptRequest | null;
  virtualClassroomViewer: VirtualClassroomViewer | null;
  knowledgeMapViewer: KnowledgeMapViewer | null;

  // PPT相关
  slides: PPTSlide[];
  activeSlideId: string | null;

  // 学术图片
  academicImages: AcademicImage[];

  // 双语文本
  bilingualTexts: BilingualText[];

  // 互动统计
  interactionStats: InteractionStats[];
  projectStats: ProjectStats;

  // 音频配置
  audioConfig: AudioConfig;
  voiceClones: VoiceClone[];
  activeVoiceCloneId: string | null;

  // 引用格式
  citationFormat: CitationFormat;

  // 账号绑定模型配置。普通用户不再在浏览器内填写模型密钥。
  aiConfig: RuntimeAIConfig;
}

interface AppContextType extends AppState {
  // 左侧文献库操作
  addFolder: (name: string) => string;
  deleteFolder: (folderId: string) => void;
  addPaper: (folderId: string, paper: Paper) => void;
  updatePaper: (paperId: string, updates: Partial<Paper>) => void;
  removePaper: (folderId: string, paperId: string) => void;
  togglePaperSelection: (paperId: string) => void;
  selectAllPapers: (folderId: string) => void;
  clearSelection: () => void;
  setActiveFolder: (folderId: string | null) => void;
  getSelectedPapers: () => Paper[];
  // 让左侧文献库定位并高亮引用对应的证据来源。
  revealPaperRequest: RevealPaperRequest | null;
  revealPaper: (paperId: string, citation?: Citation) => void;

  // 编辑器操作
  setEditorMode: (mode: EditorMode) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearChat: () => void;
  setCurrentReport: (report: Report | null) => void;
  updateReportBlock: (blockId: string, updates: Partial<RichTextBlock>) => void;
  addReportBlock: (block: RichTextBlock) => void;
  removeReportBlock: (blockId: string) => void;

  // Studio操作
  setActiveStudioFeature: (feature: StudioFeature | null) => void;
  queueStudioPrompt: (label: string, prompt: string) => void;
  consumeStudioPrompt: (id: string) => void;
  openVirtualClassroom: (viewer: Omit<VirtualClassroomViewer, 'openedAt'>) => void;
  closeVirtualClassroom: () => void;
  openKnowledgeMap: (viewer: Omit<KnowledgeMapViewer, 'openedAt'>) => void;
  closeKnowledgeMap: () => void;

  // PPT
  setSlides: (slides: PPTSlide[]) => void;
  addSlide: (slide: PPTSlide) => void;
  updateSlide: (slideId: string, updates: Partial<PPTSlide>) => void;
  removeSlide: (slideId: string) => void;
  setActiveSlide: (slideId: string | null) => void;
  updateSlideHighlight: (slideId: string, config: HighlightConfig) => void;

  // 学术图片操作
  addAcademicImage: (image: AcademicImage) => void;
  updateAcademicImage: (imageId: string, updates: Partial<AcademicImage>) => void;
  bindImageToBlock: (imageId: string, blockId: string) => void;

  // 双语文本操作
  addBilingualText: (text: BilingualText) => void;
  updateBilingualText: (textId: string, updates: Partial<BilingualText>) => void;

  // 音频配置操作
  setAudioConfig: (config: Partial<AudioConfig>) => void;
  addVoiceClone: (clone: VoiceClone) => void;
  setActiveVoiceClone: (cloneId: string | null) => void;

  // 引用格式操作
  setCitationFormat: (format: CitationFormat) => void;
  setAIConfig: (config: Partial<RuntimeAIConfig>) => void;

  // 统计操作
  updateInteractionStats: (stats: InteractionStats) => void;
}

// 默认状态
const defaultState: AppState = {
  storageScopeKey: 'guest:default-workspace',
  folders: [],
  selectedPapers: [],
  activeFolderId: null,
  editorMode: 'chat',
  chatMessages: [],
  currentReport: null,
  activeStudioFeature: null,
  queuedStudioPrompt: null,
  virtualClassroomViewer: null,
  knowledgeMapViewer: null,
  slides: [],
  activeSlideId: null,
  academicImages: [],
  bilingualTexts: [],
  interactionStats: [],
  projectStats: {
    totalViews: 0,
    totalLikes: 0,
    totalBookmarks: 0,
    totalShares: 0,
    avgWatchTime: 0,
    topSlides: [],
  },
  audioConfig: {
    voiceId: 'default',
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
  },
  voiceClones: [],
  activeVoiceCloneId: null,
  citationFormat: 'GB/T 7714',
  aiConfig: {
    apiBase: '',
    apiKey: '',
    model: '',
    visionModel: '',
    embeddingModel: '',
    ttsSpeaker: '',
  },
};

// 创建上下文
const AppContext = createContext<AppContextType | undefined>(undefined);

// Provider组件
export function AppProvider({
  children,
  storageScopeKey = defaultState.storageScopeKey,
  initialFolders = [],
  initialSelectedPaperIds = [],
}: {
  children: ReactNode;
  storageScopeKey?: string;
  initialFolders?: ProjectFolder[];
  initialSelectedPaperIds?: string[];
}) {
  const [state, setState] = useState<AppState>(() => ({
    ...defaultState,
    storageScopeKey,
    folders: initialFolders,
    selectedPapers: initialSelectedPaperIds,
    activeFolderId: initialFolders[0]?.id || null,
  }));
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);

  React.useEffect(() => {
    let messages: ChatMessage[] = [];
    try {
      messages = parseStoredChatHistory(window.localStorage.getItem(chatHistoryStorageKey(storageScopeKey)));
    } catch {
      // localStorage can be unavailable in privacy modes; the in-memory chat remains usable.
    }
    setState((previous) => ({
      ...previous,
      storageScopeKey,
      chatMessages: messages,
    }));
    setChatHistoryLoaded(true);
  }, [storageScopeKey]);

  React.useEffect(() => {
    if (!chatHistoryLoaded) return;
    try {
      window.localStorage.setItem(
        chatHistoryStorageKey(storageScopeKey),
        serializeChatHistory(state.chatMessages),
      );
    } catch {
      // The visible in-memory history remains authoritative when browser storage is unavailable.
    }
  }, [chatHistoryLoaded, state.chatMessages, storageScopeKey]);

  React.useEffect(() => {
    try {
      window.localStorage.removeItem('lingbi-ai-config');
    } catch {
      // localStorage can be unavailable in privacy modes.
    }
  }, []);

  // ==================== 左侧文献库操作 ====================
  const addFolder = useCallback((name: string): string => {
    const id = `folder-${Date.now()}`;
    const newFolder: ProjectFolder = {
      id,
      name,
      papers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setState(prev => ({
      ...prev,
      folders: [...prev.folders, newFolder],
      activeFolderId: id,
    }));
    return id;
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    setState(prev => ({
      ...prev,
      folders: prev.folders.filter(f => f.id !== folderId),
      activeFolderId: prev.activeFolderId === folderId ? null : prev.activeFolderId,
      selectedPapers: prev.selectedPapers.filter(id => {
        const folder = prev.folders.find(f => f.id === folderId);
        return !folder?.papers.some(p => p.id === id);
      }),
    }));
  }, []);

  const addPaper = useCallback((folderId: string, paper: Paper) => {
    setState(prev => ({
      ...prev,
      folders: prev.folders.map(f =>
        f.id === folderId
          ? { ...f, papers: f.papers.some(p => p.id === paper.id) ? f.papers : [...f.papers, paper], updatedAt: new Date().toISOString() }
          : f
      ),
    }));
  }, []);

  const updatePaper = useCallback((paperId: string, updates: Partial<Paper>) => {
    setState(prev => ({
      ...prev,
      folders: prev.folders.map(folder => ({
        ...folder,
        papers: folder.papers.map(paper => (
          paper.id === paperId ? { ...paper, ...updates } : paper
        )),
        updatedAt: folder.papers.some(paper => paper.id === paperId) ? new Date().toISOString() : folder.updatedAt,
      })),
    }));
  }, []);

  const removePaper = useCallback((folderId: string, paperId: string) => {
    setState(prev => ({
      ...prev,
      folders: prev.folders.map(f =>
        f.id === folderId
          ? { ...f, papers: f.papers.filter(p => p.id !== paperId), updatedAt: new Date().toISOString() }
          : f
      ),
      selectedPapers: prev.selectedPapers.filter(id => id !== paperId),
    }));
  }, []);

  const togglePaperSelection = useCallback((paperId: string) => {
    setState(prev => ({
      ...prev,
      selectedPapers: prev.selectedPapers.includes(paperId)
        ? prev.selectedPapers.filter(id => id !== paperId)
        : [...prev.selectedPapers, paperId],
    }));
  }, []);

  const selectAllPapers = useCallback((folderId: string) => {
    setState(prev => {
      const folder = prev.folders.find(f => f.id === folderId);
      if (!folder) return prev;
      return {
        ...prev,
        selectedPapers: folder.papers.map(p => p.id),
      };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedPapers: [] }));
  }, []);

  const [revealPaperRequest, setRevealPaperRequest] = useState<RevealPaperRequest | null>(null);
  const revealPaper = useCallback((paperId: string, citation?: Citation) => {
    setRevealPaperRequest({
      paperId,
      token: Date.now(),
      citation: citation ? {
        chunkId: citation.chunkId,
        chunkIndex: citation.chunkIndex,
        page: citation.page,
        excerpt: citation.excerpt,
        sourceTitle: citation.sourceTitle,
        paperShortName: citation.paperShortName,
      } : undefined,
    });
  }, []);

  const setActiveFolder = useCallback((folderId: string | null) => {
    setState(prev => ({ ...prev, activeFolderId: folderId }));
  }, []);

  const getSelectedPapers = useCallback((): Paper[] => {
    const papers: Paper[] = [];
    state.folders.forEach(folder => {
      folder.papers.forEach(paper => {
        if (state.selectedPapers.includes(paper.id)) {
          papers.push(paper);
        }
      });
    });
    return papers;
  }, [state.folders, state.selectedPapers]);

  // ==================== 编辑器操作 ====================
  const setEditorMode = useCallback((mode: EditorMode) => {
    setState(prev => ({ ...prev, editorMode: mode }));
  }, []);

  const updateChatMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setState(prev => ({
      ...prev,
      chatMessages: prev.chatMessages.map(msg =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    }));
  }, []);

  const addChatMessage = useCallback((message: ChatMessage) => {
    setState(prev => ({
      ...prev,
      chatMessages: [...prev.chatMessages, message],
    }));
  }, []);

  const clearChat = useCallback(() => {
    setState(prev => ({ ...prev, chatMessages: [] }));
  }, []);

  const setCurrentReport = useCallback((report: Report | null) => {
    setState(prev => ({ ...prev, currentReport: report }));
  }, []);

  const updateReportBlock = useCallback((blockId: string, updates: Partial<RichTextBlock>) => {
    setState(prev => {
      if (!prev.currentReport) return prev;
      return {
        ...prev,
        currentReport: {
          ...prev.currentReport,
          blocks: prev.currentReport.blocks.map(block =>
            block.id === blockId ? { ...block, ...updates } : block
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const addReportBlock = useCallback((block: RichTextBlock) => {
    setState(prev => {
      if (!prev.currentReport) return prev;
      return {
        ...prev,
        currentReport: {
          ...prev.currentReport,
          blocks: [...prev.currentReport.blocks, block],
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const removeReportBlock = useCallback((blockId: string) => {
    setState(prev => {
      if (!prev.currentReport) return prev;
      return {
        ...prev,
        currentReport: {
          ...prev.currentReport,
          blocks: prev.currentReport.blocks.filter(b => b.id !== blockId),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  // ==================== Studio操作 ====================
  const setActiveStudioFeature = useCallback((feature: StudioFeature | null) => {
    setState(prev => ({ ...prev, activeStudioFeature: feature }));
  }, []);

  const queueStudioPrompt = useCallback((label: string, prompt: string) => {
    setState(prev => ({
      ...prev,
      queuedStudioPrompt: {
        id: `studio-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        prompt,
        createdAt: new Date().toISOString(),
      },
    }));
  }, []);

  const consumeStudioPrompt = useCallback((id: string) => {
    setState(prev => (
      prev.queuedStudioPrompt?.id === id
        ? { ...prev, queuedStudioPrompt: null }
        : prev
    ));
  }, []);

  const openVirtualClassroom = useCallback((viewer: Omit<VirtualClassroomViewer, 'openedAt'>) => {
    setState(prev => ({
      ...prev,
      virtualClassroomViewer: { ...viewer, openedAt: new Date().toISOString() },
      knowledgeMapViewer: null,
    }));
  }, []);

  const closeVirtualClassroom = useCallback(() => {
    setState(prev => ({ ...prev, virtualClassroomViewer: null }));
  }, []);

  const openKnowledgeMap = useCallback((viewer: Omit<KnowledgeMapViewer, 'openedAt'>) => {
    setState(prev => ({
      ...prev,
      knowledgeMapViewer: { ...viewer, openedAt: new Date().toISOString() },
      virtualClassroomViewer: null,
    }));
  }, []);

  const closeKnowledgeMap = useCallback(() => {
    setState(prev => ({ ...prev, knowledgeMapViewer: null }));
  }, []);

  // ==================== PPT操作 ====================
  const setSlides = useCallback((slides: PPTSlide[]) => {
    setState(prev => ({ ...prev, slides }));
  }, []);

  const addSlide = useCallback((slide: PPTSlide) => {
    setState(prev => ({
      ...prev,
      slides: [...prev.slides, slide],
    }));
  }, []);

  const updateSlide = useCallback((slideId: string, updates: Partial<PPTSlide>) => {
    setState(prev => ({
      ...prev,
      slides: prev.slides.map(slide =>
        slide.id === slideId ? { ...slide, ...updates } : slide
      ),
    }));
  }, []);

  const removeSlide = useCallback((slideId: string) => {
    setState(prev => ({
      ...prev,
      slides: prev.slides.filter(slide => slide.id !== slideId),
      activeSlideId: prev.activeSlideId === slideId ? null : prev.activeSlideId,
    }));
  }, []);

  const setActiveSlide = useCallback((slideId: string | null) => {
    setState(prev => ({ ...prev, activeSlideId: slideId }));
  }, []);

  const updateSlideHighlight = useCallback((slideId: string, config: HighlightConfig) => {
    setState(prev => ({
      ...prev,
      slides: prev.slides.map(slide =>
        slide.id === slideId ? { ...slide, highlightConfig: config } : slide
      ),
    }));
  }, []);

  // ==================== 学术图片操作 ====================
  const addAcademicImage = useCallback((image: AcademicImage) => {
    setState(prev => ({
      ...prev,
      academicImages: [...prev.academicImages, image],
    }));
  }, []);

  const updateAcademicImage = useCallback((imageId: string, updates: Partial<AcademicImage>) => {
    setState(prev => ({
      ...prev,
      academicImages: prev.academicImages.map(img =>
        img.id === imageId ? { ...img, ...updates } : img
      ),
    }));
  }, []);

  const bindImageToBlock = useCallback((imageId: string, blockId: string) => {
    setState(prev => ({
      ...prev,
      academicImages: prev.academicImages.map(img =>
        img.id === imageId
          ? { ...img, bindings: { ...img.bindings, reportBlockId: blockId } }
          : img
      ),
      currentReport: prev.currentReport
        ? {
            ...prev.currentReport,
            blocks: prev.currentReport.blocks.map(block =>
              block.id === blockId
                ? { ...block, bindings: { ...block.bindings, imageId } }
                : block
            ),
          }
        : null,
    }));
  }, []);

  // ==================== 双语文本操作 ====================
  const addBilingualText = useCallback((text: BilingualText) => {
    setState(prev => ({
      ...prev,
      bilingualTexts: [...prev.bilingualTexts, text],
    }));
  }, []);

  const updateBilingualText = useCallback((textId: string, updates: Partial<BilingualText>) => {
    setState(prev => ({
      ...prev,
      bilingualTexts: prev.bilingualTexts.map(t =>
        t.id === textId ? { ...t, ...updates } : t
      ),
    }));
  }, []);

  // ==================== 音频配置操作 ====================
  const setAudioConfig = useCallback((config: Partial<AudioConfig>) => {
    setState(prev => ({
      ...prev,
      audioConfig: { ...prev.audioConfig, ...config },
    }));
  }, []);

  const addVoiceClone = useCallback((clone: VoiceClone) => {
    setState(prev => ({
      ...prev,
      voiceClones: [...prev.voiceClones, clone],
    }));
  }, []);

  const setActiveVoiceClone = useCallback((cloneId: string | null) => {
    setState(prev => ({ ...prev, activeVoiceCloneId: cloneId }));
  }, []);

  // ==================== 引用格式操作 ====================
  const setCitationFormat = useCallback((format: CitationFormat) => {
    setState(prev => ({ ...prev, citationFormat: format }));
  }, []);

  const setAIConfig = useCallback((config: Partial<RuntimeAIConfig>) => {
    setState(prev => ({
      ...prev,
      aiConfig: {
        ...prev.aiConfig,
        apiBase: '',
        apiKey: '',
        model: '',
        visionModel: '',
        embeddingModel: '',
        ttsSpeaker: typeof config.ttsSpeaker === 'string' ? config.ttsSpeaker : prev.aiConfig.ttsSpeaker,
      },
    }));
  }, []);

  // ==================== 统计操作 ====================
  const updateInteractionStats = useCallback((stats: InteractionStats) => {
    setState(prev => ({
      ...prev,
      interactionStats: [
        ...prev.interactionStats.filter(s => s.slideId !== stats.slideId),
        stats,
      ],
    }));
  }, []);

  // ==================== PPT (setSlides is already defined above) ====================

  const contextValue: AppContextType = {
    ...state,
    addFolder,
    deleteFolder,
    addPaper,
    updatePaper,
    removePaper,
    togglePaperSelection,
    selectAllPapers,
    clearSelection,
    setActiveFolder,
    getSelectedPapers,
    revealPaperRequest,
    revealPaper,
    setEditorMode,
    addChatMessage,
    updateChatMessage,
    clearChat,
    setCurrentReport,
    updateReportBlock,
    addReportBlock,
    removeReportBlock,
    setActiveStudioFeature,
    queueStudioPrompt,
    consumeStudioPrompt,
    openVirtualClassroom,
    closeVirtualClassroom,
    openKnowledgeMap,
    closeKnowledgeMap,
    setSlides,
    addSlide,
    updateSlide,
    removeSlide,
    setActiveSlide,
    updateSlideHighlight,
    addAcademicImage,
    updateAcademicImage,
    bindImageToBlock,
    addBilingualText,
    updateBilingualText,
    setAudioConfig,
    addVoiceClone,
    setActiveVoiceClone,
    setCitationFormat,
    setAIConfig,
    updateInteractionStats,
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

// 自定义Hook
export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
