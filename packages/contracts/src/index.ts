export { AI_ADAPTER_ID, APP_VERSION, ARTWORK_COLOR_PRESETS, BUNDLED_FONTS, BUILTIN_LOCALES, DOMAIN_COMMAND_NAMES, ENGINE_VERSIONS, EXPORT_FORMATS, EXTENSION_LOCALE_IDS, ILLUSTRATOR_ACCEPTANCE, IMPORT_MEDIA_TYPES, JOB_EVENT_NAMES, LAYOUT_FAMILIES, LAYOUT_SCORE_WEIGHTS, LOCALE_NAMESPACES, MM_PER_INCH, NON_DOCUMENT_CLIENT_STATE, NORMALIZATION_VERSION, NUDGE_MM, PNG_DPI_OPTIONS, PT_PER_INCH, RENDER_MEDIA_TYPES, RESOURCE_LIMITS, SCHEMA_VERSION, SSE_HEARTBEAT_INTERVAL_MS, TOLERANCES, AI_ACTION_NAMES } from "./constants.js";
export {
  CropNormalizedSchema,
  CustomLabelTextSchema,
  DateTimeSchema,
  DocumentHashSchema,
  ExportFormatSchema,
  FontIdSchema,
  FontWeightSchema,
  HexColorSchema,
  IdempotencyKeySchema,
  ImportMediaTypeSchema,
  NonEmptyStringSchema,
  NonNegativeMmSchema,
  PngDpiSchema,
  PointMmSchema,
  PositiveMmSchema,
  ProjectTitleSchema,
  RectMmSchema,
  RenderMediaTypeSchema,
  RevisionSchema,
  Sha256Schema,
  UuidSchema,
  uuidKeyed,
} from "./primitives.js";
export { nullable, object } from "./schema.js";
export { DiagnosticParamsSchema, DiagnosticSchema } from "./diagnostics.js";
export type { Diagnostic } from "./diagnostics.js";
export { ERROR_CODES, ApiErrorDetailsSchema, ApiErrorSchema, ErrorCodeSchema } from "./errors.js";
export type { ApiError, ErrorCode } from "./errors.js";
export { UNITS, fontSizePtToSvgUserUnits, pngPixelsFromMm } from "./units.js";
export { DOCUMENT_INVARIANTS } from "./invariants.js";
export {
  CanvasSchema,
  FigureDocumentSchema,
  GutterMmSchema,
  LabelFormatSchema,
  LabelOverridesSchema,
  LabelPlacementSchema,
  LabelSequenceSchema,
  LabelStyleSchema,
  LabelTypographyOverrideSchema,
  LabelTypographySchema,
  LayoutConstraintSchema,
  LayoutSettingsSchema,
  PanelGroupSchema,
  PanelSchema,
} from "./document.js";
export type {
  FigureDocumentV1,
  LabelFormat,
  LabelOverrides,
  LabelPlacement,
  LabelSequence,
  LabelStyle,
  LabelTypography,
  LayoutConstraint,
  Panel,
  PanelGroup,
} from "./document.js";
export { assertCustomLabelText, formatLabel, labelCore, resolveLabelText, unicodeLength } from "./labels.js";
export {
  LAYOUT_SCORE_WEIGHT_SUM,
  CanvasOverrideSchema,
  GutterOverrideSchema,
  LayoutFamilySchema,
  LayoutRequestByOrderSchema,
  LayoutRequestByRowsSchema,
  LayoutRequestDefaultOrderSchema,
  LayoutRequestSchema,
  LayoutScoreSchema,
  UnitIdSchema,
} from "./layout.js";
export type { LayoutRequest, LayoutScore, UnitId } from "./layout.js";
export {
  CanvasSetCommandSchema,
  DomainCommandSchema,
  GroupCreateCommandSchema,
  GroupRemoveCommandSchema,
  GroupRenameCommandSchema,
  GroupSetLockedCommandSchema,
  HistoryFlagsSchema,
  LabelSetOverridesCommandSchema,
  LabelSetStyleCommandSchema,
  LayoutSetSettingsCommandSchema,
  PanelAddCommandSchema,
  PanelRemoveCommandSchema,
  PanelRenameCommandSchema,
  PanelReorderLabelsCommandSchema,
  PanelReplaceAssetCommandSchema,
  PanelSetCropCommandSchema,
  PanelSetFramesCommandSchema,
  PanelSetLockedCommandSchema,
  PanelSetStackOrderCommandSchema,
  TransactionCandidateRequestSchema,
  TransactionCommandsRequestSchema,
  TransactionRequestSchema,
  TransactionResponseSchema,
} from "./commands.js";
export type { DomainCommand, TransactionRequest, TransactionResponse } from "./commands.js";
export { CandidateSchema } from "./candidate.js";
export type { Candidate } from "./candidate.js";
export {
  AIActionSchema,
  AIAlignActionSchema,
  AIClarificationSchema,
  AIDistributeActionSchema,
  AIIntentSchema,
  AILayoutActionSchema,
  AILayoutRequestSchema,
  AIMoveByMmActionSchema,
  AIProposalSchema,
  AIProviderCapabilitiesSchema,
  AIProviderConfigSchema,
  AIProviderSettingsSchema,
  AIRelabelActionSchema,
  AIScaleToWidthActionSchema,
  AISetCanvasActionSchema,
  AISetGutterActionSchema,
  AISetLabelStyleActionSchema,
  AISetLockActionSchema,
  AISetPanelLabelActionSchema,
  AIUnsupportedSchema,
  AlignEdgeSchema,
  AlignReferenceSchema,
  LabelOverridePatchSchema,
  LabelStylePatchSchema,
  SecretDeleteResponseSchema,
  SecretWriteRequestSchema,
  SecretWriteResponseSchema,
  StructuredOutputSchema,
  TargetRefSchema,
} from "./ai.js";
export type { AIAction, AIIntent, AILayoutRequest, AIProviderConfig, TargetRef } from "./ai.js";
export {
  AssetAcceptedSchema,
  AssetSchema,
  FailedAssetSchema,
  NormalizedAssetSchema,
  ProcessingAssetSchema,
  ReadyAssetSchema,
} from "./assets.js";
export type { Asset, NormalizedAsset } from "./assets.js";
export {
  AILayoutJobResultSchema,
  AssetImportResultSchema,
  ExportJobResultSchema,
  JobAcceptedSchema,
  JobErrorSchema,
  JobEventDataSchema,
  JobEventNameSchema,
  JobResultSchema,
  JobSchema,
  PreviewJobResultSchema,
  ProgressSchema,
  ProjectImportJobResultSchema,
  ProviderTestJobResultSchema,
} from "./jobs.js";
export type { AILayoutJobResult, Job, JobResult } from "./jobs.js";
export { LocalePackSchema, REPRESENTATIVE_MESSAGES } from "./locale.js";
export type { LocalePack } from "./locale.js";
export { PromptPresetSchema } from "./preferences.js";
export type { PromptPreset } from "./preferences.js";
export { ProjectManifestFileSchema, ProjectManifestSchema } from "./project-package.js";
export type { ProjectManifest } from "./project-package.js";
export { SVG_SUPPORT } from "./svg-support.js";
export {
  CANVAS_WIDTH_PRESETS_MM,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_CANVAS_HEIGHT_MM,
  DEFAULT_CANVAS_WIDTH_MM,
  DEFAULT_GUTTER_MM,
  DEFAULT_LABEL_COLOR,
  DEFAULT_LABEL_FONT_SIZE_PT,
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_MARGIN_MM,
  DEFAULT_MAX_AUTO_HEIGHT_MM,
  DEFAULT_MIN_PANEL_HEIGHT_MM,
  DEFAULT_MIN_PANEL_WIDTH_MM,
  DEFAULT_PNG_DPI,
  DEFAULT_PREFERRED_HEIGHT_MM,
  DEFAULT_RELATIVE_ENLARGE,
  DEFAULT_TARGET_RASTER_PPI,
  FULL_CROP,
  createDefaultFigureDocument,
} from "./defaults.js";
export {
  AssetPageSchema,
  CapabilitiesResponseSchema,
  CreateProjectResponseSchema,
  DocumentStateSchema,
  ExportRequestSchema,
  FontInfoSchema,
  FontListResponseSchema,
  HealthResponseSchema,
  HistoryRequestSchema,
  IncludeDeletedSchema,
  LayoutCandidatesRequestSchema,
  LayoutCandidatesResponseSchema,
  MaxCandidatesSchema,
  PHASE0_CAPABILITY_SAMPLE,
  PreviewRequestSchema,
  ProjectPageSchema,
  ProjectSchema,
  ProjectWriteRequestSchema,
  QueryLimitSchema,
  ResourceLimitsSchema,
  RevisionPageSchema,
  RevisionSnapshotSchema,
  pageSchema,
} from "./api.js";
export type {
  CapabilitiesResponse,
  ExportRequest,
  HealthResponse,
  PreviewRequest,
  Project,
} from "./api.js";
export {
  ArtifactRowSchema,
  AssetRowSchema,
  CandidateRowSchema,
  IdempotencyRowSchema,
  JobEventRowSchema,
  JobRowSchema,
  ProjectRevisionRowSchema,
  ProjectRowSchema,
  ProviderSettingsRowSchema,
} from "./storage.js";
export { buildOpenApiDocument, renderOpenApiDocument, toJsonSchema } from "./openapi.js";
export {
  isExportRequest,
  isFigureDocument,
  isProjectManifest,
  isTransactionRequest,
} from "./guards.js";
