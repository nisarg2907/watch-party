interface SyncStatusProps {
  lastAction: { action: string; username: string } | null
  syncStatus: { delta: number; timestamp: number } | null
}

export const SyncStatus = ({ lastAction, syncStatus }: SyncStatusProps) => {
  return (
    <div className="flex items-center justify-center gap-4 text-xs text-slate-400 py-1">
      {lastAction && (
        <div>
          <span className="font-medium text-emerald-400">{lastAction.username}</span> {lastAction.action}
        </div>
      )}
      {syncStatus && (
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Sync:</span>
          <span className={Math.abs(syncStatus.delta) > 0.3 ? 'text-orange-400' : 'text-emerald-400'}>
            {syncStatus.delta > 0 ? '+' : ''}{syncStatus.delta.toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  )
}
