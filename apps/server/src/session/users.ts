// Store socket ID -> username mapping
const userMap = new Map<string, string>()

/**
 * Add or update user mapping
 */
export const setUser = (socketId: string, username: string): void => {
  userMap.set(socketId, username)
}

/**
 * Get username for socket ID
 */
export const getUser = (socketId: string): string | undefined => {
  return userMap.get(socketId)
}

/**
 * Remove user mapping
 */
export const deleteUser = (socketId: string): void => {
  userMap.delete(socketId)
}

/**
 * Get all user mappings
 */
export const getAllUsers = (): Map<string, string> => {
  return userMap
}
