import { runBasicTests } from "../../utils/adapter"
import { hydrateDates, NatsKVAdapter, natsKey } from "../src"
import "dotenv/config"
import { connect } from "@nats-io/transport-node"
import { Kvm } from "@nats-io/kv"

const nc = await connect({
  servers: "nats://localhost:4222",
  authenticator: undefined,
})

const kvm = new Kvm(nc)
const authKV = await kvm.create("authKV")

runBasicTests({
  adapter: NatsKVAdapter(authKV, { baseKeyPrefix: "testApp." }),
  db: {
    disconnect: async () => {
      await nc.close()
    },
    async account({ provider, providerAccountId }) {
      const data = await authKV.get(
        `testApp.user.account.${natsKey(provider)}.${natsKey(providerAccountId)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async user(id: string) {
      const data = await authKV.get(`testApp.user.${natsKey(id)}`)
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async session(sessionToken) {
      const data = await authKV.get(
        `testApp.user.session.${natsKey(sessionToken)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
    async verificationToken(where) {
      const data = await authKV.get(
        `testApp.user.token.${natsKey(where.identifier)}.${natsKey(where.token)}`
      )
      if (!data || data.length == 0) return null
      return hydrateDates(data.json())
    },
  },
})
