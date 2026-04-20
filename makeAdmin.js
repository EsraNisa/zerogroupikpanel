import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Hata: SUPABASE_URL ve SUPABASE_SERVICE_KEY .env dosyasında tanımlı olmalıdır.');
  process.exit(1);
}

// FIX: Email argümanı zorunlu — varsayılan değer kaldırıldı
if (!process.argv[2]) {
  console.error('Hata: Kullanım: node makeAdmin.js <email>');
  console.error('Örnek: node makeAdmin.js admin@mail.com');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const email = process.argv[2];

(async () => {
  console.log(`"${email}" kullanıcısı admin yapılıyor...`);

  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Kullanıcılar listelenemedi:', listError.message);
    process.exit(1);
  }

  const user = users.users.find(u => u.email === email);
  if (!user) {
    console.error(`"${email}" e-postasına sahip kullanıcı bulunamadı.`);
    console.log('Mevcut kullanıcılar:', users.users.map(u => u.email).join(', '));
    process.exit(1);
  }

  console.log(`Kullanıcı bulundu: ${user.id}`);

  const existingMeta = user.user_metadata || {};

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...existingMeta, admin: true }
  });

  if (error) {
    console.error('Admin yetkisi eklenemedi:', error.message);
    process.exit(1);
  }

  console.log(`✓ "${email}" kullanıcısına admin yetkisi eklendi.`);
  console.log('Kullanıcı bilgileri:', {
    id: data.user.id,
    email: data.user.email,
    admin: data.user.user_metadata?.admin
  });
})();
