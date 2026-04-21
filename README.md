# Zero Group - İK Panel ve Personel Yönetim Sistemi



Bu proje, **Zero Group** bünyesindeki personellerin çalışma günlerini, kurum hak edişlerini, avans ve masraflarını takip etmek amacıyla özel olarak geliştirilmiş web tabanlı bir İnsan Kaynakları otomasyonudur. Backend Node.js ve Express ile, veritabanı ve kimlik doğrulama işlemleri ise Supabase ile sağlanmaktadır.



## 🚀 Özellikler



* **Yetkilendirme:** Supabase Auth entegrasyonu. Sadece Zero Group yetkilileri (admin) veri ekleyip silebilir.

* **Personel Yönetimi:** Personel bilgileri, günlük/aylık maaş, IBAN ve iletişim bilgilerinin takibi.

* **Kurum Yönetimi:** Hizmet verilen kurumların iletişim ve adres bilgilerinin yönetimi.

* **Çalışma Kayıtları:** Seçilen tarih aralığına göre gün hesabı, brüt maaş, net personel ödemesi, kurum faturası ve net kar oranlarının otomatik hesaplanması.

* **Ödeme Takibi:** Personel ve kurumlar için ödeme durumlarının (Bekliyor / Ödendi) izlenmesi.

* **Gelişmiş Raporlama:** Aylık, personel bazlı ve kurum bazlı detaylı rapor ekranları. Tüm raporların tek tıkla **Excel (.xlsx)** formatında dışa aktarılması.

* **Arşivleme:** Eski kayıtların silinmeden listeden gizlenmesi (Raporlara dahil olmaya devam eder).



## 🛠 Kullanılan Teknolojiler



* **Backend:** Node.js, Express.js

* **Veritabanı & Auth:** Supabase (PostgreSQL)

* **Validasyon:** Zod

* **Güvenlik:** Helmet, Express Rate Limit, Cookie-parser

* **Frontend:** Vanilla JavaScript, HTML5, CSS3 (Tamamen responsive, mobil uyumlu tasarım)

* **Araçlar:** SheetJS (Excel export için)



## 📦 Kurulum



**1. Bağımlılıkları Yükleyin**

Proje dizininde terminali açarak gerekli paketleri kurun:

```bash

npm install

