import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const tenantData = {
  name: 'Hotel Gharana Tree',
  slug: 'hotel-gharana-tree',
  restaurant_code: 'GHARANA',
  email: 'hotelgharanatree@gmail.com',
  phone: '+919102003333',
};

const branchData = {
  name: 'Main Branch',
  address: 'Jail Road, Opp. Rampur Police Station, Gaya - 823001, Bihar'
};

const IMAGE_MAP = {
  'dosa': 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?q=80&w=400&auto=format&fit=crop',
  'egg': 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?q=80&w=400&auto=format&fit=crop',
  'toast': 'https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=400&auto=format&fit=crop',
  'poha': 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?q=80&w=400&auto=format&fit=crop',
  'paratha': 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=400&auto=format&fit=crop',
  'poori': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=400&auto=format&fit=crop',
  'idli': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=400&auto=format&fit=crop', // reusing for idli
  'fruits': 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?q=80&w=400&auto=format&fit=crop',
  'juice': 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?q=80&w=400&auto=format&fit=crop',
  'curd': 'https://images.unsplash.com/photo-1584278858532-6a68f6bf7e05?q=80&w=400&auto=format&fit=crop',
  'tea': 'https://images.unsplash.com/photo-1576092762791-dd9e2220afa1?q=80&w=400&auto=format&fit=crop',
  'coffee': 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=400&auto=format&fit=crop',
  'salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=400&auto=format&fit=crop',
  'raita': 'https://images.unsplash.com/photo-1548943487-a2e4e43b4859?q=80&w=400&auto=format&fit=crop',
  'soup veg': 'https://images.unsplash.com/photo-1547592180-85f173990554?q=80&w=400&auto=format&fit=crop',
  'soup non': 'https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?q=80&w=400&auto=format&fit=crop',
  'snack': 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=400&auto=format&fit=crop',
  'fries': 'https://images.unsplash.com/photo-1576107232684-1279f390859f?q=80&w=400&auto=format&fit=crop',
  'tikka veg': 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=400&auto=format&fit=crop',
  'tikka non': 'https://images.unsplash.com/photo-1599487405270-81f18579fc95?q=80&w=400&auto=format&fit=crop',
  'noodles': 'https://images.unsplash.com/photo-1585032226651-759b368d7246?q=80&w=400&auto=format&fit=crop',
  'chinese': 'https://images.unsplash.com/photo-1525755662778-989d0524087e?q=80&w=400&auto=format&fit=crop',
  'curry veg': 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?q=80&w=400&auto=format&fit=crop',
  'curry non': 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?q=80&w=400&auto=format&fit=crop',
  'dal': 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=400&auto=format&fit=crop',
  'thali': 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=400&auto=format&fit=crop',
  'biryani': 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=400&auto=format&fit=crop',
  'rice': 'https://images.unsplash.com/photo-1539755530862-00f623c00f52?q=80&w=400&auto=format&fit=crop',
  'bread': 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=400&auto=format&fit=crop', // generic indian
  'naan': 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=400&auto=format&fit=crop',
  'dessert': 'https://images.unsplash.com/photo-1563805042-7684c8a9e9cb?q=80&w=400&auto=format&fit=crop',
  'ice cream': 'https://images.unsplash.com/photo-1570197781417-0a82375c9371?q=80&w=400&auto=format&fit=crop',
  'shake': 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?q=80&w=400&auto=format&fit=crop',
  'drink': 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=400&auto=format&fit=crop',
  'default': 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=400&auto=format&fit=crop'
};

const getImageUrlForName = (name, cat) => {
  const l = (name + ' ' + cat).toLowerCase();
  if (l.includes('dosa')) return IMAGE_MAP['dosa'];
  if (l.includes('egg ')) return IMAGE_MAP['egg'];
  if (l.includes('toast')) return IMAGE_MAP['toast'];
  if (l.includes('poha')) return IMAGE_MAP['poha'];
  if (l.includes('paratha')) return IMAGE_MAP['paratha'];
  if (l.includes('poori')) return IMAGE_MAP['poori'];
  if (l.includes('idli')) return IMAGE_MAP['idli'];
  if (l.includes('fruit')) return IMAGE_MAP['fruits'];
  if (l.includes('juice')) return IMAGE_MAP['juice'];
  if (l.includes('curd') || l.includes('raita')) return IMAGE_MAP['curd'];
  if (l.includes('tea')) return IMAGE_MAP['tea'];
  if (l.includes('coffee')) return IMAGE_MAP['coffee'];
  if (l.includes('salad')) return IMAGE_MAP['salad'];
  if (l.includes('soup') && l.includes('veg')) return IMAGE_MAP['soup veg'];
  if (l.includes('soup')) return IMAGE_MAP['soup non'];
  if (l.includes('fries') || l.includes('potato')) return IMAGE_MAP['fries'];
  if (l.includes('tikka') && l.includes('paneer')) return IMAGE_MAP['tikka veg'];
  if (l.includes('tikka') || l.includes('kebab')) return IMAGE_MAP['tikka non'];
  if (l.includes('noodle') || l.includes('chowmein')) return IMAGE_MAP['noodles'];
  if (l.includes('chinese') || l.includes('manchurian') || l.includes('chilly')) return IMAGE_MAP['chinese'];
  if (l.includes('dal')) return IMAGE_MAP['dal'];
  if (l.includes('biryani')) return IMAGE_MAP['biryani'];
  if (l.includes('rice') || l.includes('pulao') || l.includes('basmati')) return IMAGE_MAP['rice'];
  if (l.includes('thali')) return IMAGE_MAP['thali'];
  if (l.includes('naan') || l.includes('roti')) return IMAGE_MAP['naan'];
  if (l.includes('ice cream')) return IMAGE_MAP['ice cream'];
  if (l.includes('brownie') || l.includes('dessert') || l.includes('halwa') || l.includes('jamun')) return IMAGE_MAP['dessert'];
  if (l.includes('shake')) return IMAGE_MAP['shake'];
  if (l.includes('drink') || l.includes('coke') || l.includes('soda') || l.includes('water') || l.includes('lassi') || l.includes('mocktail') || l.includes('mojito')) return IMAGE_MAP['drink'];
  if (l.includes('paneer') || l.includes('mushroom') || l.includes('aloo') || l.includes('kofta') || l.includes('sabzi')) return IMAGE_MAP['curry veg'];
  if (l.includes('chicken') || l.includes('murgh') || l.includes('mutton') || l.includes('gosht') || l.includes('fish')) return IMAGE_MAP['curry non'];
  return IMAGE_MAP['default'];
};

const categories = [
  {
    name: 'Breakfast',
    items: [
      { name: 'Choice of Dosa', price: 199.00, veg: true },
      { name: 'Egg Preparation', price: 149.00, veg: false },
      { name: 'Boiled Egg', price: 149.00, veg: false },
      { name: 'Fried Egg', price: 149.00, veg: false },
      { name: 'Omelette', price: 149.00, veg: false },
      { name: 'Cereals With Milk', price: 149.00, veg: true },
      { name: 'Bread Toast', price: 110.00, veg: true },
      { name: 'Poha', price: 119.00, veg: true },
      { name: 'Paratha', price: 119.00, veg: true },
      { name: 'Poori Bhaji', price: 199.00, veg: true },
      { name: 'Idli', price: 199.00, veg: true },
      { name: 'Fresh Fruits', price: 149.00, veg: true },
      { name: 'Canned Juice', price: 115.00, veg: true },
      { name: 'Canned Soft Drink (300ml)', price: 115.00, veg: true },
      { name: 'Plain Curd', price: 79.00, veg: true },
      { name: 'Tea', price: 59.00, veg: true },
      { name: 'Coffee', price: 69.00, veg: true },
    ]
  },
  {
    name: 'Salad',
    items: [
      { name: 'Bageeche Ka Salad', price: 129.00, veg: true },
      { name: 'Onion Salad', price: 79.00, veg: true },
      { name: 'Fruit Salad', price: 149.00, veg: true },
      { name: 'Cucumber Salad', price: 110.00, veg: true },
    ]
  },
  {
    name: 'Raita',
    items: [
      { name: 'Pineapple/Fruits', price: 129.00, veg: true },
      { name: 'Boondi', price: 99.00, veg: true },
      { name: 'Mix Veg.', price: 99.00, veg: true },
      { name: 'Cucumber', price: 99.00, veg: true },
    ]
  },
  {
    name: 'Soup (Veg.)',
    items: [
      { name: 'Mushroom Soup', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 30}], veg: true },
      { name: 'Veg. Sweet Corn Soup', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 30}], veg: true },
      { name: 'Veg. Hot & Sour Soup', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 30}], veg: true },
      { name: 'Veg. Manchow Soup', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 30}], veg: true },
      { name: 'Tomato Soup', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 30}], veg: true },
    ]
  },
  {
    name: 'Soup (Non Veg.)',
    items: [
      { name: 'Chicken Veg. Noodles Soup', price: 109.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 50}], veg: false },
      { name: 'Chicken Sweet Corn Soup', price: 109.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 50}], veg: false },
      { name: 'Chicken Hot & Sour Soup', price: 109.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 50}], veg: false },
      { name: 'Chicken Manchow Soup', price: 109.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 50}], veg: false },
    ]
  },
  {
    name: 'Snacks (Veg.)',
    items: [
      { name: 'Kaju Fry', price: 379.00, veg: true },
      { name: 'Paneer Pakoda', price: 249.00, veg: true },
      { name: 'Veg. Pakoda', price: 179.00, veg: true },
      { name: 'French Fries', price: 179.00, veg: true },
      { name: 'Garlic Crispy Potato', price: 179.00, veg: true },
      { name: 'Veg. Cutlet (4Pc)', price: 199.00, veg: true },
    ]
  },
  {
    name: 'Starter Veg. (Tandoori)',
    items: [
      { name: 'Veg. Kebab Platter (9Pc.)', price: 349.00, veg: true },
      { name: 'Hariyali Paneer Tikka', price: 249.00, veg: true },
      { name: 'Multani Paneer (Gharana Special)', price: 299.00, veg: true },
      { name: 'Hara Bhara Kebab', price: 249.00, veg: true },
      { name: 'Malai Paneer Tikka', price: 249.00, veg: true },
      { name: 'Tandoori Mushroom Tikka', price: 279.00, veg: true },
      { name: 'Dahi Ke Kebab', price: 279.00, veg: true },
      { name: 'Paneer Tikka', price: 249.00, veg: true },
    ]
  },
  {
    name: 'Starter Non Veg. (Tandoori)',
    items: [
      { name: 'Non Veg. Kebab Platter (9Pc)', price: 499.00, veg: false },
      { name: 'Tandoori Chicken Full', price: 499.00, veg: false },
      { name: 'Tandoori Chicken Half', price: 299.00, veg: false },
      { name: 'Kashmiri Murgh Tikka', price: 329.00, veg: false },
      { name: 'Lahsooni Murgh Tikka', price: 329.00, veg: false },
      { name: 'Pahadi Murgh Tikka', price: 329.00, veg: false },
      { name: 'Chicken Tikka', price: 329.00, veg: false },
      { name: 'Murgh Reshmi Seek', price: 329.00, veg: false },
      { name: 'Murg Malai Tikka', price: 329.00, veg: false },
      { name: 'Fish Tikka', price: 329.00, veg: false },
    ]
  },
  {
    name: 'Chinese Kitchen (Non-Veg.)',
    items: [
      { name: 'Chicken Noodles', price: 299.00, veg: false },
      { name: 'Chicken 65', price: 299.00, veg: false },
      { name: 'Lemon Chicken', price: 299.00, veg: false },
      { name: 'Chicken Fried Rice', price: 299.00, veg: false },
      { name: 'Drums Of Heaven (Chicken Wings)', price: 299.00, veg: false },
      { name: 'Chilly Chicken Dry', price: 299.00, veg: false },
      { name: 'Chicken Lollypop', price: 349.00, veg: false },
      { name: 'Chilly Chicken Gravy', price: 349.00, veg: false },
      { name: 'Pepper Chilly Fish', price: 349.00, veg: false },
      { name: 'Egg Fried Rice', price: 279.00, veg: false },
      { name: 'Egg Noodles', price: 279.00, veg: false },
    ]
  },
  {
    name: 'Chinese Kitchen (Veg.)',
    items: [
      { name: 'Veg. Manchurian', price: 249.00, variantGroup: 'Style', variants: [{name: 'Dry', delta: 0}, {name: 'Gravy', delta: 30}], veg: true },
      { name: 'Crispy Corn', price: 249.00, veg: true },
      { name: 'Chilly Baby Corn', price: 249.00, veg: true },
      { name: 'Honey Chilli Potato', price: 249.00, veg: true },
      { name: 'Spicy Chilly Potato', price: 249.00, veg: true },
      { name: 'Hakka Noodles', price: 249.00, veg: true },
      { name: 'Schezwan Noodles', price: 249.00, veg: true },
      { name: 'Vegetable Noodles', price: 249.00, veg: true },
      { name: 'Chilly Garlic Noodle', price: 249.00, veg: true },
      { name: 'Vegetable Chowmein', price: 249.00, veg: true },
      { name: 'Veg. Fried Rice', price: 249.00, veg: true },
      { name: 'Chilly Paneer', price: 299.00, variantGroup: 'Style', variants: [{name: 'Dry', delta: 0}, {name: 'Gravy', delta: 30}], veg: true },
      { name: 'Paneer Noodle', price: 299.00, veg: true },
      { name: 'Chilly Mushroom', price: 279.00, variantGroup: 'Style', variants: [{name: 'Dry', delta: 0}, {name: 'Gravy', delta: 20}], veg: true },
      { name: 'Veg. Thai Roll', price: 299.00, veg: true },
    ]
  },
  {
    name: 'Indian Curry Veg.',
    items: [
      { name: 'Banarasi Malai Kofta', price: 299.00, veg: true },
      { name: 'Veg. Kofta Curry', price: 299.00, veg: true },
      { name: 'Matar Paneer', price: 299.00, veg: true },
      { name: 'Paneer Moti Masala', price: 299.00, veg: true },
      { name: 'Paneer Tikka Masala', price: 299.00, veg: true },
      { name: 'Paneer Butter Masala', price: 299.00, veg: true },
      { name: 'Paneer Lababdar', price: 299.00, veg: true },
      { name: 'Chatpate Palak Paneer', price: 299.00, veg: true },
      { name: 'Paneer Taka-Tak (Gharana Special)', price: 299.00, veg: true },
      { name: 'Punjabi Kadhai Paneer', price: 299.00, veg: true },
      { name: 'Lucknow Ka Paneer Do Pyaza', price: 299.00, veg: true },
      { name: 'Navratna Korma (Gharana Special)', price: 349.00, veg: true },
      { name: 'Mushroom Do Pyaza', price: 279.00, veg: true },
      { name: 'Matar Mushroom Masala', price: 279.00, veg: true },
      { name: 'Subz Handi - Mix Vegetables', price: 249.00, veg: true },
      { name: 'Gharana Special Kaju Curry', price: 349.00, veg: true },
      { name: 'Aloo Do Pyaza', price: 249.00, veg: true },
      { name: 'Aloo Gobhi Adraki', price: 249.00, veg: true },
      { name: 'Aloo Jeera', price: 249.00, veg: true },
      { name: 'Aaj Ki Special Sabzi', price: 249.00, veg: true },
      { name: 'Chatapata Mushroom Masala', price: 279.00, veg: true },
    ]
  },
  {
    name: 'Dal / Dal Fry',
    items: [
      { name: 'Dal Tadka', price: 129.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 70}], veg: true },
      { name: 'Dal Fry', price: 129.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 70}], veg: true },
      { name: 'Dal Makhani', price: 179.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 70}], veg: true },
    ]
  },
  {
    name: 'Indian Curry (Non Veg.)',
    items: [
      { name: 'Jungle Murgh (6/4Pc)', price: 249.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 200}], veg: false },
      { name: 'Dehati Murgh (6/4Pc)', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 150}], veg: false },
      { name: 'Punjabi Butter Chicken With Bone (6/4Pc)', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 250}], veg: false },
      { name: 'Teen Mirch Ka Murgh (6/4Pc)', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 150}], veg: false },
      { name: 'Kadhai Chicken (6/4Pc)', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 150}], veg: false },
      { name: 'Bhuna Gosht (4Pc)', price: 499.00, veg: false },
      { name: 'Rajasthani Laal Maans (4Pc)', price: 499.00, veg: false },
      { name: 'Mutton Rogan Josh (4Pc)', price: 499.00, veg: false },
      { name: 'Chicken Tikka Masala (8/4Pc)', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 200}], veg: false },
      { name: 'Punjabi Butter Chicken Boneless (8Pc)', price: 499.00, veg: false },
      { name: 'Murgh Lahori (8Pc)', price: 499.00, veg: false },
      { name: 'Chicken Taka-Tak (8Pc)', price: 499.00, veg: false },
      { name: 'Murgh Musallam (8Pc)', price: 599.00, veg: false },
      { name: 'Murgh Musallam (4Pc)', price: 399.00, veg: false },
      { name: 'Egg Curry (2Pc)', price: 199.00, veg: false },
      { name: 'Egg Curry (4Pc)', price: 299.00, veg: false },
    ]
  },
  {
    name: 'Only For Room Service',
    items: [
      { name: 'Gharana Spl. Thali', price: 399.00, veg: true },
      { name: 'Gharana Spl. Non-Veg.', price: 499.00, veg: false },
    ]
  },
  {
    name: 'Biryani Lucknow',
    items: [
      { name: 'Veg. Biryani', price: 199.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 80}], veg: true },
      { name: 'Egg Biryani', price: 299.00, veg: false },
      { name: 'Chicken Biryani', price: 299.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 100}], veg: false },
      { name: 'Mutton Biryani', price: 449.00, veg: false },
      { name: 'Khichdi (Dahi, Papad)', price: 279.00, veg: true },
      { name: 'Curd Rice', price: 249.00, veg: true },
    ]
  },
  {
    name: 'Choice of Rice',
    items: [
      { name: 'Safed Basmati', price: 99.00, variantGroup: 'Portion', variants: [{name: 'Half', delta: 0}, {name: 'Full', delta: 50}], veg: true },
      { name: 'Jeera Rice', price: 189.00, veg: true },
      { name: 'Peas Pulao', price: 189.00, veg: true },
      { name: 'Vegetable Pulao', price: 189.00, veg: true },
      { name: 'Kashmiri Pulao', price: 199.00, veg: true },
      { name: 'Paneer Pulao', price: 229.00, veg: true },
    ]
  },
  {
    name: 'Breads',
    items: [
      { name: 'Tandoori Roti (Plain)', price: 25.00, veg: true },
      { name: 'Tandoori Roti (Butter)', price: 30.00, veg: true },
      { name: 'Plain Naan', price: 40.00, veg: true },
      { name: 'Butter Naan', price: 45.00, veg: true },
      { name: 'Paratha (Laccha/Pudina)', price: 49.00, veg: true },
      { name: 'Garlic Naan', price: 55.00, veg: true },
      { name: 'Cheese Naan', price: 79.00, veg: true },
      { name: 'Stuffed Amritsari Naan (Aloo/Pyaza/Paneer)', price: 60.00, veg: true },
      { name: 'Tawa Roti', price: 25.00, variantGroup: 'Type', variants: [{name: 'Plain', delta: 0}, {name: 'Butter', delta: 5}], veg: true },
    ]
  },
  {
    name: 'Desserts',
    items: [
      { name: 'Chocolate Brownie With Ice Cream', price: 199.00, veg: true },
      { name: 'Chocolate Brownie', price: 149.00, veg: true },
      { name: 'Vanilla Ice Cream', price: 89.00, veg: true },
      { name: 'Strawberry Ice Cream', price: 89.00, veg: true },
      { name: 'Chocolate Ice Cream', price: 89.00, veg: true },
      { name: 'Pista Ice Cream', price: 99.00, veg: true },
      { name: 'Desserts Of The Day', price: 99.00, veg: true },
      { name: 'Tuti Fruti', price: 125.00, veg: true },
      { name: 'Moong Dal Halwa', price: 125.00, veg: true },
      { name: 'Stuffed Gulab Jamun', price: 49.00, veg: true },
    ]
  },
  {
    name: 'Drinks',
    items: [
      { name: 'Masala Tea', price: 59.00, veg: true },
      { name: 'Coffee', price: 69.00, veg: true },
      { name: 'Aerated Drinks', price: 69.00, veg: true },
      { name: 'Masala Coke', price: 115.00, veg: true },
      { name: 'Blue Lagoon', price: 115.00, veg: true },
      { name: 'Shikanji', price: 115.00, veg: true },
      { name: 'Canned Juice', price: 115.00, veg: true },
      { name: 'Fresh Lime Soda', price: 115.00, veg: true },
      { name: 'Butter Milk', price: 119.00, veg: true },
      { name: 'Sweet Lassi', price: 119.00, veg: true },
      { name: 'Gharana Special Mocktail', price: 149.00, veg: true },
      { name: 'Mint Mojito', price: 149.00, veg: true },
      { name: 'Mango Masala', price: 149.00, veg: true },
      { name: 'Brownie Shake', price: 199.00, veg: true },
      { name: 'Chocolate Shake', price: 199.00, veg: true },
      { name: 'Strawberry Shake', price: 199.00, veg: true },
      { name: 'Vanilla Shake', price: 199.00, veg: true },
      { name: 'Cold Coffee', price: 199.00, veg: true },
      { name: 'Mango Shake', price: 199.00, veg: true },
      { name: 'Mineral Bottle Water', price: 25.00, veg: true },
      { name: 'Canned Cold Drink', price: 115.00, veg: true },
    ]
  }
];

// Helper to sanitize slug
const slugify = text => text.toString().toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^\w\-]+/g, '')
  .replace(/\-\-+/g, '-')
  .replace(/^-+/, '')
  .replace(/-+$/, '');

// Object to store downloaded images to avoid re-downloading
const downloadedImages = {};

async function uploadImage(url, slug) {
  if (downloadedImages[url]) {
    return downloadedImages[url]; // return the previously uploaded URL for this source URL
  }
  
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const fileName = `${tenantData.slug}/menu/${slug}.webp`;
    
    // Check if it already exists
    const { data: existData } = await supabase.storage.from('menu-images').list(`${tenantData.slug}/menu`, {
      search: `${slug}.webp`
    });
    
    if (existData && existData.find(e => e.name === `${slug}.webp`)) {
      console.log(`Image already exists in storage for ${slug}`);
    } else {
      const { data, error } = await supabase.storage.from('menu-images').upload(fileName, buffer, {
        contentType: 'image/webp',
        upsert: true
      });
      if (error) throw error;
      console.log(`Uploaded image for ${slug}`);
    }
    
    const { data: publicUrlData } = supabase.storage.from('menu-images').getPublicUrl(fileName);
    downloadedImages[url] = publicUrlData.publicUrl;
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error(`Error uploading image for ${slug}:`, err.message);
    return null;
  }
}

async function run() {
  console.log('Starting import...');
  
  // 1. Create/Get Auth User
  let authUser;
  const { data: listData } = await supabase.auth.admin.listUsers();
  authUser = listData?.users.find(u => u.email === 'iamvrshraj@gmail.com');
  
  if (!authUser) {
    throw new Error('User iamvrshraj@gmail.com not found. Please ensure the user exists.');
  }
  const userId = authUser.id;

  // 2. Create/Get Tenant
  let tenantId;
  const { data: existingTenant } = await supabase.from('tenants').select('id').eq('slug', tenantData.slug).single();
  if (existingTenant) {
    tenantId = existingTenant.id;
    console.log(`Tenant exists: ${tenantId}`);
  } else {
    const { data: tData, error: tErr } = await supabase.from('tenants').insert({
      name: tenantData.name,
      slug: tenantData.slug,
      restaurant_code: tenantData.restaurant_code,
      status: 'active'
    }).select('id').single();
    if (tErr) throw tErr;
    tenantId = tData.id;
    console.log(`Created tenant: ${tenantId}`);
  }

  // 3. Create/Get Branch
  let branchId;
  const { data: existingBranch } = await supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('name', branchData.name).single();
  if (existingBranch) {
    branchId = existingBranch.id;
  } else {
    const { data: bData, error: bErr } = await supabase.from('branches').insert({
      tenant_id: tenantId,
      name: branchData.name,
      address: branchData.address,
      status: 'active',
      timezone: 'Asia/Kolkata'
    }).select('id').single();
    if (bErr) throw bErr;
    branchId = bData.id;
  }

  // Update app_metadata
  await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: tenantId, branch_ids: [branchId] }
  });

  let categoryCount = 0;
  let itemCount = 0;
  let variantCount = 0;
  let imageCount = 0;

  // 4. Create Categories and Items
  for (let cIdx = 0; cIdx < categories.length; cIdx++) {
    const cat = categories[cIdx];
    const catSlug = slugify(cat.name);
    
    let catId;
    const { data: exCat } = await supabase.from('menu_categories').select('id').eq('tenant_id', tenantId).eq('slug', catSlug).single();
    if (exCat) {
      catId = exCat.id;
    } else {
      const { data: nCat, error: cErr } = await supabase.from('menu_categories').insert({
        tenant_id: tenantId,
        name: cat.name,
        slug: catSlug,
        sort_order: cIdx,
        is_active: true
      }).select('id').single();
      if (cErr) throw cErr;
      catId = nCat.id;
      categoryCount++;
    }

    for (let iIdx = 0; iIdx < cat.items.length; iIdx++) {
      const item = cat.items[iIdx];
      const itemSlug = slugify(item.name);
      
      let itemId;
      const { data: exItem } = await supabase.from('menu_items').select('id, image_url').eq('tenant_id', tenantId).eq('slug', itemSlug).single();
      
      let imageUrl = null;
      if (exItem && exItem.image_url) {
        imageUrl = exItem.image_url;
      } else {
        const sourceUrl = getImageUrlForName(item.name, cat.name);
        imageUrl = await uploadImage(sourceUrl, itemSlug);
        if (imageUrl) imageCount++;
      }

      if (exItem) {
        itemId = exItem.id;
        // Optionally update item if needed
      } else {
        const { data: nItem, error: iErr } = await supabase.from('menu_items').insert({
          tenant_id: tenantId,
          category_id: catId,
          name: item.name,
          slug: itemSlug,
          price: item.price,
          base_price: item.price,
          pricing_type: item.variants ? 'variable' : 'fixed',
          is_veg: item.veg,
          is_available: true,
          status: 'active',
          sort_order: iIdx,
          image_url: imageUrl,
          spice_level: 'none'
        }).select('id').single();
        
        if (iErr) {
            console.error('Error inserting item', item.name, iErr.message);
            continue;
        }
        itemId = nItem.id;
        itemCount++;

        // Add variants if any
        if (item.variants) {
          // 1. Create modifier group
          const { data: mgData, error: mgErr } = await supabase.from('modifier_groups').insert({
            tenant_id: tenantId,
            name: item.variantGroup,
            selection_mode: 'single',
            is_required: true,
            min_select: 1,
            max_select: 1,
            is_active: true,
            display_order: 0
          }).select('id').single();
          
          if (!mgErr) {
            // Link group to item
            await supabase.from('menu_item_modifier_groups').insert({
              tenant_id: tenantId,
              menu_item_id: itemId,
              modifier_group_id: mgData.id,
              display_order: 0,
              is_active: true
            });

            // Add options
            const optionsToInsert = item.variants.map((v, vIdx) => ({
              tenant_id: tenantId,
              modifier_group_id: mgData.id,
              name: v.name,
              price_delta_minor: v.delta,
              is_default: vIdx === 0,
              display_order: vIdx,
              is_active: true
            }));
            const { error: optErr } = await supabase.from('modifier_options').insert(optionsToInsert);
            if (!optErr) {
              variantCount += item.variants.length;
            } else {
                console.error("Variant error:", optErr);
            }
          }
        }
      }
    }
  }

  // Output Report
  console.log('\n--- IMPORT REPORT ---');
  console.log(`Restaurant: ${tenantData.name} (ID: ${tenantId})`);
  console.log(`Branch: ${branchData.name} (ID: ${branchId})`);
  console.log(`Categories created: ${categoryCount}`);
  console.log(`Menu items created: ${itemCount}`);
  console.log(`Variants created: ${variantCount}`);
  console.log(`Images successfully attached: ${imageCount}`);
  
  // Also create a QR code for testing
  const { data: tableData } = await supabase.from('tables').insert({
      tenant_id: tenantId,
      branch_id: branchId,
      table_number: '1',
      display_name: 'Table 1',
      qr_token: 'GHARANA1'
  }).select('id').single();
  
  console.log('Customer app token: GHARANA1 (use /qr/GHARANA1)');
}

run().catch(console.error);
