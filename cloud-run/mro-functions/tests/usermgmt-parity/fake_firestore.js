// Firestore SDK 동작을 흉내내는 테스트 전용 인메모리 스텁. lib/writeIdempotency.js의
// withIdempotency(), lib/auth.js의 authenticateSession(), lib/writeLock.js의 acquireLock()/
// releaseLock()이 실제로 호출하는 메서드(collection().doc().get()/set()/update()/delete(),
// runTransaction())만 구현한다. 실제 Firestore/GCP에 대한 네트워크 호출은 전혀 하지 않으며,
// 실제 프로덕션 코드(lib/writeIdempotency.js, lib/auth.js, lib/writeLock.js)를 그대로 이
// 스텁에 통과시켜 테스트한다. markthreadseen-parity/fake_firestore.js와 동일한 내용 —
// 기존 관례대로 이 테스트 디렉터리에도 자체 사본을 둔다.
class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }
  async get() {
    const data = this.store.get(this.id);
    const exists = data !== undefined;
    return { exists, data: () => data, ref: this };
  }
  async set(data) {
    this.store.set(this.id, Object.assign({}, data));
  }
  async update(patch) {
    const cur = this.store.get(this.id) || {};
    this.store.set(this.id, Object.assign({}, cur, patch));
  }
  async delete() {
    this.store.delete(this.id);
  }
}

class FakeFirestore {
  constructor() {
    this.collections = new Map();
  }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const store = this.collections.get(name);
    return { doc: function (id) { return new FakeDocRef(store, id); } };
  }
  async runTransaction(fn) {
    const tx = {
      get: function (docRef) { return docRef.get(); },
      set: function (docRef, data) { docRef.store.set(docRef.id, Object.assign({}, data)); },
      update: function (docRef, patch) {
        const cur = docRef.store.get(docRef.id) || {};
        docRef.store.set(docRef.id, Object.assign({}, cur, patch));
      }
    };
    return fn(tx);
  }
}

module.exports = { FakeFirestore };
