interface HeaderProps {
  username: string
  connectionStatus: 'connecting' | 'connected' | 'error'
}

export const Header = ({ username, connectionStatus }: HeaderProps) => {
  return (
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Watch Party</h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-0.5 sm:mt-1">Synced viewing experience</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <span className={`inline-flex h-2 w-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-300">{username}</span>
        </div>
      </div>
    </header>
  )
}
