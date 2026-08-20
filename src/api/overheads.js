import client from './client'

export const overheadsAPI = {
  list: () => client.get('/overheads/'),
  create: (data) => client.post('/overheads/', data),
  update: (id, data) => client.patch(`/overheads/${id}`, data),
  remove: (id) => client.delete(`/overheads/${id}`),
}
