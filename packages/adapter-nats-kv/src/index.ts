/**
 * <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16}}>
 *  <p>Official <a href="https://nats.io">NATS KeyValue</a> adapter for Auth.js / NextAuth.js.</p>
 *  <a href="https://docs.upstash.com/redis">
 *   <img style={{display: "block"}} src="https://authjs.dev/img/adapters/upstash-redis.svg" width="60"/>
 *  </a>
 * </div>
 *
 * ## Installation
 *
 * ```bash npm2yarn
 * npm install @auth/nats-kv-adapter
 * ```
 *
 * @module @auth/nats-kv-adapter
 */
import {
  type Adapter,
  type AdapterUser,
  type AdapterAccount,
  type AdapterSession,
  type VerificationToken,
  isDate,
} from "@auth/core/adapters"
import { KV } from "@nats-io/kv"

/** */
/* Usage:

  const kvm = new Kvm(client);
  const authKV = await kvm.create("authKV");

  export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: NatsKVAdapter(authKV),
  providers: [],
})

*/

/** This is the interface of the Upstash Redis adapter options. */
export interface NextKVAdapterOptions {
  /**
   * The base prefix for your keys
   */
  baseKeyPrefix?: string
  /**
   * The prefix for the `account` key
   */
  accountKeyPrefix?: string
  /**
   * The prefix for the `accountByUserId` key
   */
  accountByUserIdPrefix?: string
  /**
   * The prefix for the `emailKey` key
   */
  emailKeyPrefix?: string
  /**
   * The prefix for the `sessionKey` key
   */
  sessionKeyPrefix?: string
  /**
   * The prefix for the `sessionByUserId` key
   */
  sessionByUserIdKeyPrefix?: string
  /**
   * The prefix for the `user` key
   */
  userKeyPrefix?: string
  /**
   * The prefix for the `verificationToken` key
   */
  verificationTokenKeyPrefix?: string
}

export const defaultOptions = {
  baseKeyPrefix: "",
  accountKeyPrefix: "user.account.",
  accountByUserIdPrefix: "user.account.by-user-id.",
  emailKeyPrefix: "user.email.",
  sessionKeyPrefix: "user.session.",
  sessionByUserIdKeyPrefix: "user.session.by-user-id.",
  userKeyPrefix: "user.",
  verificationTokenKeyPrefix: "user.token.",
}

export function hydrateDates(json: object) {
  return Object.entries(json).reduce((acc, [key, val]) => {
    acc[key] = isDate(val) ? new Date(val as string) : val
    return acc
  }, {} as any)
}

//replace symbols that are not allowed in keys
export function natsKey(identifier: string) {
  return identifier.replace("@", "_at_").replace(":", "_colon_") as string
}

export function nats2json(value: any) {
  return JSON.parse(value.toString())
}

export function NatsKVAdapter(
  natsConnect:
    | (() => Promise<
        { kv: KV } & {
          [Symbol.asyncDispose]: () => Promise<void>
        }
      >)
    | KV,
  options: NextKVAdapterOptions = {}
): Adapter {
  const mergedOptions = {
    ...defaultOptions,
    ...options,
  }

  const { baseKeyPrefix } = mergedOptions
  const accountKeyPrefix = baseKeyPrefix + mergedOptions.accountKeyPrefix
  const accountByUserIdPrefix =
    baseKeyPrefix + mergedOptions.accountByUserIdPrefix
  const emailKeyPrefix = baseKeyPrefix + mergedOptions.emailKeyPrefix
  const sessionKeyPrefix = baseKeyPrefix + mergedOptions.sessionKeyPrefix
  const sessionByUserIdKeyPrefix =
    baseKeyPrefix + mergedOptions.sessionByUserIdKeyPrefix
  const userKeyPrefix = baseKeyPrefix + mergedOptions.userKeyPrefix
  const verificationTokenKeyPrefix =
    baseKeyPrefix + mergedOptions.verificationTokenKeyPrefix

  const setObjectAsJson = async (key: string, obj: any) => {
    return await natsPut(key, JSON.stringify(obj))
  }

  const natsPut = async (key: string, obj: any) => {
    if (typeof natsConnect == "function") {
      await using nc = await natsConnect()
      return await nc.kv.put(key, obj)
    } else {
      return await natsConnect.put(key, obj)
    }
  }
  const natsPurge = async (key: string) => {
    if (typeof natsConnect == "function") {
      await using nc = await natsConnect()
      return await nc.kv.purge(key)
    } else {
      return await natsConnect.purge(key)
    }
  }
  const natsGet = async (key: string) => {
    if (typeof natsConnect == "function") {
      await using nc = await natsConnect()
      return await nc.kv.get(key)
    } else {
      return await natsConnect.get(key)
    }
  }

  const setAccount = async (id: string, account: AdapterAccount) => {
    const accountKey = accountKeyPrefix + natsKey(id)
    await setObjectAsJson(accountKey, account)
    natsPut(accountByUserIdPrefix + natsKey(account.userId), accountKey)
    return account
  }

  const getAccount = async (id: string) => {
    const data = await natsGet(accountKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const account = data.json<AdapterAccount>()
    return hydrateDates(account)
  }

  const setSession = async (
    id: string,
    session: AdapterSession
  ): Promise<AdapterSession> => {
    const sessionKey = sessionKeyPrefix + natsKey(id)
    await setObjectAsJson(sessionKey, session)
    await natsPut(
      sessionByUserIdKeyPrefix + natsKey(session.userId),
      sessionKey
    )
    return session
  }

  const getSession = async (id: string) => {
    const data = await natsGet(sessionKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const session = data.json<AdapterSession>()
    return hydrateDates(session)
  }

  const setUser = async (
    id: string,
    user: AdapterUser
  ): Promise<AdapterUser> => {
    await setObjectAsJson(userKeyPrefix + natsKey(id), user)
    await natsPut(`${emailKeyPrefix}${natsKey(user.email)}`, id)
    return user
  }

  const getUser = async (id: string) => {
    const data = await natsGet(userKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const user = data.json<AdapterUser>()
    return hydrateDates(user)
  }

  return {
    async createUser(user) {
      const id = crypto.randomUUID()
      // TypeScript thinks the emailVerified field is missing
      // but all fields are copied directly from user, so it's there
      return await setUser(id, { ...user, id })
    },
    getUser,
    async getUserByEmail(email) {
      const data = await natsGet(emailKeyPrefix + natsKey(email))
      if (!data || data.length == 0) return null
      const userId = data.string()
      return await getUser(userId)
    },
    async getUserByAccount(account) {
      const dbAccount = await getAccount(
        `${account.provider}.${account.providerAccountId}`
      )
      if (!dbAccount) return null
      return await getUser(dbAccount.userId)
    },
    async updateUser(updates) {
      const userId = updates.id as string
      const user = await getUser(userId)
      return await setUser(userId, { ...(user as AdapterUser), ...updates })
    },
    async linkAccount(account) {
      const id = `${account.provider}.${account.providerAccountId}`
      return await setAccount(id, { ...account, id })
    },
    createSession: (session) => setSession(session.sessionToken, session),
    async getSessionAndUser(sessionToken) {
      const session = await getSession(sessionToken)
      if (!session) return null
      const user = await getUser(session.userId)
      if (!user) return null
      return { session, user }
    },
    async updateSession(updates) {
      const session = await getSession(updates.sessionToken)
      if (!session) return null
      return await setSession(updates.sessionToken, { ...session, ...updates })
    },
    async deleteSession(sessionToken) {
      await natsPurge(sessionKeyPrefix + sessionToken)
    },
    async createVerificationToken(verificationToken) {
      await setObjectAsJson(
        verificationTokenKeyPrefix +
          natsKey(verificationToken.identifier) +
          "." +
          natsKey(verificationToken.token),
        verificationToken
      )
      return verificationToken
    },
    async useVerificationToken(verificationToken) {
      const tokenKey =
        verificationTokenKeyPrefix +
        natsKey(verificationToken.identifier) +
        "." +
        natsKey(verificationToken.token)
      const data = await natsGet(tokenKey)
      if (!data || data.length == 0) return null
      const token = data.json<VerificationToken>()
      await natsPurge(tokenKey)
      return hydrateDates(token)
      // return reviveFromJson(token)
    },
    async unlinkAccount(account) {
      const id = `${account.provider}.${account.providerAccountId}`
      const dbAccount = await getAccount(natsKey(id))
      if (!dbAccount) return
      const accountKey = `${accountKeyPrefix}${natsKey(id)}`
      await natsPurge(accountKey)
      await natsPurge(`${(accountByUserIdPrefix + dbAccount.userId) as string}`)
    },
    async deleteUser(userId) {
      const user = await getUser(natsKey(userId))
      if (!user) return
      const accountByUserKey = accountByUserIdPrefix + natsKey(userId)
      const accountKey = await natsGet(accountByUserKey).then((data) =>
        data?.string()
      )
      const sessionByUserIdKey = sessionByUserIdKeyPrefix + natsKey(userId)
      const sessionKey = await natsGet(sessionByUserIdKey).then((data) =>
        data?.string()
      )
      await natsPurge(userKeyPrefix + natsKey(userId))
      await natsPurge(`${emailKeyPrefix}${natsKey(user.email)}`)
      await natsPurge(accountKey as string)
      await natsPurge(accountByUserKey)
      await natsPurge(sessionKey as string)
      await natsPurge(sessionByUserIdKey)
    },
  }
}
