import { buildSchema, graphql } from 'graphql';
export const demoSDL = `
"Корневые запросы учебного магазина"
type Query { viewer: User! products: [Product!]! product(id: ID!): Product orders: [Order!]! }
type Mutation { addToCart(productId: ID!, quantity: Int = 1): Cart! updateProfile(name: String!): User! }
type User { id: ID! name: String! email: String! avatar: String orders: [Order!]! }
type Product { id: ID! name: String! price: Float! description: String stock: Int! category: Category! }
type Category { id: ID! name: String! products: [Product!]! }
type Order { id: ID! status: String! total: Float! items: [OrderItem!]! customer: User! }
type OrderItem { quantity: Int! product: Product! }
type Cart { id: ID! items: [OrderItem!]! total: Float! }
`;
const category = { id: 'c1', name: 'Электроника' };
const products = [{ id: 'p1', name: 'Наушники Studio', price: 7900, description: 'Беспроводные наушники', stock: 12, category }, { id: 'p2', name: 'Клавиатура Air', price: 4500, description: 'Компактная клавиатура', stock: 8, category }];
category.products = products;
const viewer = { id: 'u1', name: 'Алексей', email: 'demo@example.test', avatar: null };
const orders = [{ id: 'o1', status: 'DELIVERED', total: 7900, items: [{ quantity: 1, product: products[0] }], customer: viewer }];
viewer.orders = orders;
const root = { viewer, products, orders, product: ({ id }) => products.find(p => p.id === id), addToCart: ({ productId, quantity = 1 }) => { const product = products.find(p => p.id === productId); if (!product) throw new Error('Товар не найден'); return { id: 'cart1', items: [{ quantity, product }], total: product.price * quantity }; }, updateProfile: ({ name }) => ({ ...viewer, name }) };
export async function demoExecute(payload) { return graphql({ schema: buildSchema(demoSDL), source: payload.query, variableValues: payload.variables, operationName: payload.operationName, rootValue: root }); }
export const scenarios = [
 { test: 'profile.spec / basic', query: 'query Profile { viewer { id name } }' },
 { test: 'catalog.spec / list', query: 'query Catalog { products { id name price category { id name } } }' },
 { test: 'orders.spec / list', query: 'query Orders { orders { id status total } }' },
 { test: 'profile.spec / details', query: 'query ProfileDetails($email: Boolean!) { me: viewer { ...UserDetails email @include(if: $email) } } fragment UserDetails on User { id name avatar orders { id } }', variables: { email: true } },
 { test: 'catalog.spec / product', query: 'query Product($id: ID!) { product(id: $id) { id description stock category { products { id } } } }', variables: { id: 'p1' } },
 { test: 'cart.spec / add', query: 'mutation Add { addToCart(productId: "p1", quantity: 2) { id total items { quantity product { id name } } } }' }
];
