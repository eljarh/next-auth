import { runBasicTests } from "../../utils/adapter"
import {
  hydrateDates,
  NatsKVAdapterAsync,
  NatsKVAdapter,
  natsKey,
  AKV,
  KV_NAME,
} from "../src"
import "dotenv/config"
import { connect } from "@nats-io/transport-node"
import { Kvm, KV } from "@nats-io/kv"
import { a } from "vitest/dist/suite-ghspeorC.js"

async function setupAuthKV() {
  const nc = await connect({
    servers: "nats://localhost:5222",
    authenticator: undefined,
  })
  const kvm = new Kvm(nc)
  await kvm.create("authKV")
  await nc.close()
}

/*export async function getNextAuthKVandCloseConnection<T>(name: T): Promise<
  AKV<T> & {
    [Symbol.asyncDispose]: () => Promise<void>
  }
>*/

export async function getNextAuthKVandCloseConnection(): Promise<
  { authKV: KV } & {
    [Symbol.asyncDispose]: () => Promise<void>
  }
> {
  const nc = await connect({
    servers: "nats://localhost:5222",
    authenticator: undefined,
  })
  const kvm = new Kvm(nc)
  const kv = await kvm.open("authKV")

  return {
    authKV: kv,
    [Symbol.asyncDispose]: async () => {
      await nc.close()
    },
  }
}

await setupAuthKV()
//await using akv = await getNextAuthKVandCloseConnection()
//const authKV = akv["authKV"]

runBasicTests({
  //adapter: await NatsKVAdapterAsync(getNextAuthKVandCloseConnection, {
  adapter: await NatsKVAdapter(
    await getNextAuthKVandCloseConnection().then((akv) => akv.authKV),
    {
      baseKeyPrefix: "testApp.",
    }
  ),
  db: {
    disconnect: async () => {
      //do nothing - since the connection itself handles this  (was: await nc.close())
    },
    async account({ provider, providerAccountId }) {
      console.log("account")
      await using akv = await getNextAuthKVandCloseConnection()
      const data = await akv.authKV.get(
        `testApp.user.account.${natsKey(provider)}.${natsKey(providerAccountId)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async user(id: string) {
      console.log("user")
      await using akv = await getNextAuthKVandCloseConnection()
      const data = await akv.authKV.get(`testApp.user.${natsKey(id)}`)
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async session(sessionToken) {
      console.log("session")
      await using akv = await getNextAuthKVandCloseConnection()
      const data = await akv.authKV.get(
        `testApp.user.session.${natsKey(sessionToken)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async verificationToken(where) {
      console.log("verificationToken")
      await using akv = await getNextAuthKVandCloseConnection()
      const data = await akv.authKV.get(
        `testApp.user.token.${natsKey(where.identifier)}.${natsKey(where.token)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
  },
})
