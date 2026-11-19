import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toRequestMessages } from '../reply.js'
import type { AssistantMessage, UserMessage } from '../types.js'

test('history with reminder snapshots sends only standard roles and preserves attachments and continuation', () => {
  const question: UserMessage = {
    id: 'question',
    role: 'user',
    content: 'Describe this image',
    files: [
      {
        id: 'image',
        serverId: 'file-image',
        name: 'image.png',
        size: 1,
        isImage: true,
        mimeType: 'image/png',
      },
    ],
    createdAt: 1,
  }
  const reply: AssistantMessage = {
    id: 'reply',
    role: 'assistant',
    createdAt: 2,
    model: 'deepseek-flash',
    latestReminder: '2026-11-19,Thursday,,Web,English',
    prefix: true,
    status: 'done',
    blocks: [{ type: 'text', text: 'An image' }],
  }
  const current: UserMessage = { ...question, id: 'current', content: 'Continue', files: [] }
  const prefix: AssistantMessage = {
    ...reply,
    id: 'prefix',
    status: 'stopped',
    latestReminder: '2026-11-20,Friday,,Web,English',
    blocks: [{ type: 'text', text: 'More detail' }],
  }
  const before = structuredClone({ question, reply, current, prefix })

  assert.deepEqual(toRequestMessages([question, reply], current, prefix), [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'file', file_id: 'file-image' } },
        { type: 'text', text: 'Describe this image' },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'An image' }] },
    { role: 'user', content: 'Continue' },
    { role: 'assistant', content: [{ type: 'text', text: 'More detail' }] },
  ])
  assert.deepEqual({ question, reply, current, prefix }, before)
})
