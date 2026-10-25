// Minimal in-memory stand-in for the MongoDB collections SpendLoom uses.
// Supports equality filters, sort/limit, $set with dotted paths and a
// unique index, which is all the app needs.

const { ObjectId } = require("mongodb");

const same = (a, b) =>
    a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b;

const matches = (doc, filter = {}) =>
    Object.entries(filter).every(([key, value]) => same(doc[key], value));

// Deep copy that keeps ObjectId and Date instances (structuredClone doesn't).
function clone(value) {
    if (value instanceof ObjectId) return new ObjectId(value.toHexString());
    if (value instanceof Date) return new Date(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    }
    return value;
}

function setPath(target, dotted, value) {
    const keys = dotted.split(".");
    let node = target;
    keys.slice(0, -1).forEach(key => {
        if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
        node = node[key];
    });
    node[keys.at(-1)] = value;
}

function fakeCollection({ unique } = {}) {
    const docs = [];

    return {
        docs,
        find(filter) {
            let sortSpec = {};
            let max = Infinity;
            const cursor = {
                sort(spec) { sortSpec = spec; return cursor; },
                limit(n) { max = n; return cursor; },
                async toArray() {
                    const keys = Object.entries(sortSpec);
                    return docs
                        .filter(doc => matches(doc, filter))
                        .sort((a, b) => {
                            for (const [k, dir] of keys) {
                                if (a[k] < b[k]) return -dir;
                                if (a[k] > b[k]) return dir;
                            }
                            return 0;
                        })
                        .slice(0, max)
                        .map(doc => clone(doc));
                }
            };
            return cursor;
        },
        async findOne(filter) {
            const doc = docs.find(d => matches(d, filter));
            return doc ? clone(doc) : null;
        },
        async insertOne(doc) {
            if (unique && docs.some(d => d[unique] === doc[unique])) {
                const error = new Error("duplicate key");
                error.code = 11000;
                throw error;
            }
            const _id = new ObjectId();
            docs.push({ ...clone(doc), _id });
            return { insertedId: _id };
        },
        async updateOne(filter, update) {
            const doc = docs.find(d => matches(d, filter));
            if (!doc) return { matchedCount: 0 };
            Object.entries(update.$set || {}).forEach(([key, value]) => setPath(doc, key, value));
            return { matchedCount: 1 };
        },
        async deleteOne(filter) {
            const index = docs.findIndex(d => matches(d, filter));
            if (index === -1) return { deletedCount: 0 };
            docs.splice(index, 1);
            return { deletedCount: 1 };
        }
    };
}

function fakeDb() {
    return {
        users: fakeCollection({ unique: "email" }),
        sessions: fakeCollection(),
        expenses: fakeCollection()
    };
}

module.exports = { fakeDb };
