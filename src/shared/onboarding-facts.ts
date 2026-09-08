export const TOTAL_DOWNLOAD_MB = 200;

/** The download broken down, largest first — the model dominating is the point. */
export const PACKAGE_ROWS = [
  {
    label: 'Detection model',
    mb: 165,
    reason:
      'Local AI model ships with the extension, so your data stays on this machine.',
  },
  {
    label: 'Inference runtime',
    mb: 35,
    reason:
      'Runs the model in your browser and supports both CPU and GPU acceleration',
  },
  {
    label: 'Pattern engine',
    mb: 1.3,
    reason:
      'Allows pattern detection even when Local AI detection is off.',
  },
] as const;

export const RUNTIME_FACTS = {
  loadedRamGb: 1,
  defaultUnloadMinutes: 10,
  autoDisableMemoryGb: 2,
  warnMemoryGb: 4,
} as const;
