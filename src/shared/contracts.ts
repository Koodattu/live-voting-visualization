export type SessionLanguage = "en" | "fi";
export type SessionStatus = "draft" | "live" | "ended";
export type QuestionType = "single_choice" | "feedback";
export type QuestionStatus = "unshown" | "open" | "closed";
export type DisplayTheme = "light" | "dark";

export interface DraftOptionInput {
  label: string;
}

export interface DraftQuestionInput {
  type: QuestionType;
  prompt: string;
  options: DraftOptionInput[];
}

export interface DraftSessionInput {
  title: string;
  joinName: string;
  language: SessionLanguage;
  questions: DraftQuestionInput[];
}

export interface GuestCredentials {
  sessionId: string;
  guestId: string;
  secret: string;
}

export interface OptionSummary {
  id: string;
  label: string;
  position: number;
}

export interface OptionResult extends OptionSummary {
  count: number;
  percentage: number;
}

export interface ChoiceResult {
  responseCount: number;
  participationDenominator: number;
  participationPercentage: number;
  options: OptionResult[];
}

export interface PublicComment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PresentedQuestion {
  id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  status: QuestionStatus;
  options: OptionSummary[];
}

export interface DisplayQuestion extends PresentedQuestion {
  result: ChoiceResult | null;
  commentsVisible: boolean;
  comments: PublicComment[];
}

export interface PublicQuestionResult extends DisplayQuestion {}

export interface OwnResponse {
  questionId: string;
  optionId?: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantSnapshot {
  role: "participant";
  sessionId: string;
  title: string;
  joinName: string;
  language: SessionLanguage;
  status: SessionStatus;
  stateVersion: number;
  joinedCount: number;
  currentQuestion: PresentedQuestion | null;
  ownResponse: OwnResponse | null;
  results: PublicQuestionResult[];
}

export interface DisplaySnapshot {
  role: "display";
  sessionId: string;
  title: string;
  joinName: string;
  language: SessionLanguage;
  status: SessionStatus;
  stateVersion: number;
  displayTheme: DisplayTheme;
  commentWallVisible: boolean;
  joinedCount: number;
  currentQuestion: DisplayQuestion | null;
  previousQuestion: DisplayQuestion | null;
}

export interface AdminQuestion extends DisplayQuestion {
  openedAt: string | null;
  closedAt: string | null;
  participationDenominator: number | null;
}

export interface AdminSessionSummary {
  id: string;
  title: string;
  joinName: string;
  language: SessionLanguage;
  status: SessionStatus;
  joinedCount: number;
  questionCount: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AdminSessionDetail extends AdminSessionSummary {
  role: "admin";
  stateVersion: number;
  controlRevision: number;
  displayTheme: DisplayTheme;
  commentWallVisible: boolean;
  presentedPosition: number | null;
  furthestPresentedPosition: number;
  questions: AdminQuestion[];
}

export interface LiveSessionSummary {
  id: string;
  title: string;
  joinName: string;
  language: SessionLanguage;
  joinedCount: number;
  stage: "lobby" | "question";
}

export type PresenterAction =
  | "open_first"
  | "close"
  | "previous"
  | "next"
  | "end"
  | "toggle_theme"
  | "set_comment_wall";

export interface PresenterCommand {
  requestId: string;
  action: PresenterAction;
  expectedControlRevision: number;
  value?: boolean;
}

export interface ResponseSubmission {
  requestId: string;
  questionId: string;
  optionId?: string;
  content?: string;
}

export interface SubscribeRequest {
  joinName: string;
  role: "participant" | "display" | "admin";
  credentials?: GuestCredentials;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface ServerToClientEvents {
  "session:snapshot": (
    snapshot: ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail,
  ) => void;
  "sessions:changed": () => void;
}

export interface ClientToServerEvents {
  "session:subscribe": (
    request: SubscribeRequest,
    acknowledge: (
      result: CommandResult<
        ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail
      >,
    ) => void,
  ) => void;
  "session:snapshot": (
    acknowledge: (
      result: CommandResult<
        ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail
      >,
    ) => void,
  ) => void;
  "response:submit": (
    submission: ResponseSubmission,
    acknowledge: (result: CommandResult<ParticipantSnapshot>) => void,
  ) => void;
  "presenter:command": (
    command: PresenterCommand,
    acknowledge: (result: CommandResult<AdminSessionDetail>) => void,
  ) => void;
}

export interface SocketData {
  role?: SubscribeRequest["role"];
  sessionId?: string;
  guestId?: string;
  clientAddress?: string;
}
