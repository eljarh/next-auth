import "isomorphic-fetch"
import { runBasicTests } from "@next-auth/adapter-test"
import { hydrateDates, NatsKVAdapter } from "../src"
import "dotenv/config"
import { connect } from "@nats-io/transport-node";
import { Kvm } from "@nats-io/kv";

try{
const nc = await connect({
    servers: "nats://localhost:5222"
  });

const kvm = new Kvm(nc);
const authKV = kvm.create("authKV");

runBasicTests({
  adapter: NatsKVAdapter( await authKV, { baseKeyPrefix: "testApp." }),
  db: {
    disconnect: async () => {
      await (await nc).close()
    },
    async user(id: string) {
      const data = await authKV.get(`testApp.user.${id}`)
      if (!data) return null
      return hydrateDates(data)
    },
    async account({ provider, providerAccountId }) {
      const data = await authKV.get(
        `testApp.user.account.${provider}.${providerAccountId}`
      )
      if (!data) return null
      return hydrateDates(data)
    },
    async session(sessionToken) {
      const data = await authKV.get(
        `testApp.user.session.${sessionToken}`
      )
      if (!data) return null
      return hydrateDates(data)
    },
    async verificationToken(where) {
      const data = await authKV.get(
        `testApp.user.token.${where.identifier}.${where.token}`
      )
      if (!data) return null
      return hydrateDates(data)
    },
  },
})
} catch(error) {
  expect(error).toBe('Error occurred asynchronously');
}
