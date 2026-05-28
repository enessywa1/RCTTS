import { collection, addDoc, serverTimestamp, getDocs, query, limit } from "firebase/firestore";
import { db } from "./firebase";

const AGENCIES = [
  "Zebre Car Express",
  "Ritco",
  "Capital Express",
  "LogExpress",
  "Swift RW",
  "EastLink Courier",
  "Horizon Transport",
  "PaceSetter Express"
];

export async function seedInitialData() {
  const agenciesSnapshot = await getDocs(query(collection(db, "agencies"), limit(1)));
  if (!agenciesSnapshot.empty) return; // Already seeded

  console.log("Seeding data...");

  // Seed Agencies
  const agencyIds: string[] = [];
  for (const name of AGENCIES) {
    const docRef = await addDoc(collection(db, "agencies"), {
      name,
      active: true,
      tier: "Premium",
      contact: `+250 788 123 ${Math.floor(Math.random() * 900) + 100}`,
      createdAt: serverTimestamp()
    });
    agencyIds.push(docRef.id);
  }

  // Seed some dummy tickets
  for (let i = 0; i < 5; i++) {
    await addDoc(collection(db, "tickets"), {
      senderName: "Mutesi Claudine",
      senderPhone: "+250 788 000 000",
      receiverName: "Niyomugabo Eric",
      receiverPhone: "+250 788 111 111",
      packageType: "Electronics",
      weight: 4.2,
      declaredValue: 150000,
      agencyId: agencyIds[Math.floor(Math.random() * agencyIds.length)],
      status: "In Transit",
      route: "Kigali → Huye",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  console.log("Seeding complete.");
}
