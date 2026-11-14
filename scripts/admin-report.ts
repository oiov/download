import { readAdminData, type AdminInput } from '../docker/server/admin-data'

const chunks: Buffer[] = []; let size = 0
for await (const chunk of process.stdin) {
  size += chunk.length
  if (size > 16384) throw new Error('查询参数过大')
  chunks.push(chunk)
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AdminInput
console.log(JSON.stringify(readAdminData(input)))
