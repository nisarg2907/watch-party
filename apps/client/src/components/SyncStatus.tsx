interface SyncStatusProps {
  lastAction: { action: string; username: string } | null
}

export const SyncStatus = ({ lastAction }: SyncStatusProps) => {
  if (!lastAction) return null
  
  return (
    <div className="flex items-center justify-center text-xs text-slate-400 py-1">
      <span className="font-medium text-emerald-400">{lastAction.username}</span>
      <span className="ml-1">{lastAction.action}</span>
    </div>
  )
}
