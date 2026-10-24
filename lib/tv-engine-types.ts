export type TvSessionStatus =
  | 'disconnected'
  | 'launching'
  | 'connected_auth'
  | 'connected_guest'
  | 'error';

export interface TvPointerMarker {
  x: number; // normalized 0..1000
  y: number; // normalized 0..1000
  endX?: number; // normalized 0..1000 for drags/drawings
  endY?: number; // normalized 0..1000 for drags/drawings
  kind: 'click' | 'drag' | 'draw';
  label?: string;
  timestamp: number;
}

export interface TvSessionInfo {
  status: TvSessionStatus;
  url: string;
  pageTitle: string;
  accountLabel: string | null;
  viewportWidth: number;
  viewportHeight: number;
  frameDataUrl: string | null;
  lastActionPointer: TvPointerMarker | null;
  authNotice?: string | null;
  errorMessage?: string | null;
  updatedAt: number;
}

export interface TvConnectPayload {
  mode: 'cookies' | 'json' | 'guest';
  sessionId?: string;
  sessionIdSign?: string;
  deviceT?: string;
  cookieJson?: string;
  chartUrl?: string;
}

export type TvManualInputPayload =
  | {
      type: 'click';
      x: number; // normalized 0..1000
      y: number; // normalized 0..1000
      button?: 'left' | 'right';
      doubleClick?: boolean;
    }
  | {
      type: 'drag';
      fromX: number; // normalized 0..1000
      fromY: number; // normalized 0..1000
      toX: number; // normalized 0..1000
      toY: number; // normalized 0..1000
    }
  | {
      type: 'wheel';
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
    }
  | {
      type: 'type';
      text: string;
      pressEnter?: boolean;
    }
  | {
      type: 'key';
      key: string;
    }
  | {
      type: 'navigate';
      url: string;
    }
  | {
      type: 'refresh';
    };

export interface TvAgentStep {
  id: string;
  stepNumber: number;
  toolName: string;
  description: string;
  status: 'running' | 'done' | 'blocked_order' | 'error';
  pointer?: TvPointerMarker | null;
  timestamp: number;
}

export interface TvPendingOrderApproval {
  side: 'BUY' | 'SELL';
  orderType: string;
  quantity?: string;
  price?: string;
  stopLoss?: string;
  takeProfit?: string;
  summary: string;
  resumePrompt: string;
}

export type TvAgentStreamEvent =
  | {
      type: 'status';
      message: string;
    }
  | {
      type: 'step';
      step: TvAgentStep;
    }
  | {
      type: 'frame';
      frameDataUrl: string;
      pageTitle: string;
      url: string;
      pointer?: TvPointerMarker | null;
    }
  | {
      type: 'order_approval_needed';
      order: TvPendingOrderApproval;
      message: string;
    }
  | {
      type: 'complete';
      summary: string;
      frameDataUrl: string | null;
      stepsCount: number;
    }
  | {
      type: 'error';
      message: string;
    };
