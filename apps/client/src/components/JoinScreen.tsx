interface JoinScreenProps {
  inputUsername: string
  setInputUsername: (value: string) => void
  handleJoin: () => void
  connectionStatus: 'connecting' | 'connected' | 'error'
  connectionError: string | null
}

export const JoinScreen = ({
  inputUsername,
  setInputUsername,
  handleJoin,
  connectionStatus,
  connectionError,
}: JoinScreenProps) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border-2 border-emerald-500 mb-4">
            <span className="text-3xl">🎬</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Watch Party
          </h1>
          <p className="text-slate-400">
            Watch YouTube videos in sync with friends
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 shadow-xl backdrop-blur">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            What should we call you?
          </label>
          <input
            type="text"
            value={inputUsername}
            onChange={(e) => setInputUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="Enter your name..."
            maxLength={20}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-50 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40 mb-4"
            autoFocus
          />
          <button
            onClick={handleJoin}
            disabled={!inputUsername.trim() || connectionStatus !== 'connected'}
            className="w-full inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg transition hover:bg-emerald-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400"
          >
            {connectionStatus === 'connected' ? 'Join Watch Party' : 'Connecting...'}
          </button>
          
          {connectionError && (
            <p className="mt-3 text-xs text-red-400 text-center">{connectionError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
