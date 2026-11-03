import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Chính sách quyền riêng tư",
    summary: "Mingly dùng những dữ liệu nào khi bạn đăng nhập và tham gia phòng.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật",
    updatedAt: "03/11/2026",
    sections: [
      { title: "Đăng nhập", paragraphs: ["Nếu đăng nhập bằng Google, Mingly nhận thông tin hồ sơ cơ bản từ tài khoản của bạn, như tên, email và ảnh đại diện. Chúng tôi dùng thông tin này để đăng nhập, tạo hồ sơ và giúp người cùng phòng nhận ra bạn. Mingly không dùng dữ liệu Google của bạn để chạy quảng cáo hoặc bán cho bên khác.", "Bạn có thể đăng xuất trong ứng dụng hoặc thu hồi quyền truy cập trong tài khoản Google. Thu hồi quyền không tự xóa dữ liệu đã lưu ở Mingly."] },
      { title: "Dữ liệu phòng", paragraphs: ["Chúng tôi lưu thông tin phòng, quyền tham gia, tin nhắn, bảng vẽ và lựa chọn video để phòng hoạt động. Người cùng phòng có thể thấy tên hiển thị, ảnh đại diện nếu có, trạng thái tham gia và nội dung bạn gửi.", "Chủ phòng có thể xem và dùng các công cụ quản lý phòng. Khi chủ phòng xóa phòng, dữ liệu gắn với phòng trong cơ sở dữ liệu, gồm tin nhắn và bảng vẽ, cũng bị xóa. Kết thúc phòng chỉ đóng quyền tham gia; dữ liệu phòng vẫn được lưu."] },
      { title: "Cuộc gọi và video", paragraphs: ["Âm thanh, camera và màn hình được truyền qua nhà cung cấp cuộc gọi để người trong phòng xem và nghe. Mingly không có tính năng ghi lại cuộc gọi. Người tham gia khác vẫn có thể tự ghi màn hình bằng công cụ riêng.", "Bạn có thể tắt micro, camera hoặc chia sẻ màn hình bất cứ lúc nào. Video YouTube phát qua trình phát nhúng của YouTube; YouTube có thể xử lý dữ liệu theo chính sách của họ."] },
      { title: "Nhà cung cấp và bảo mật", paragraphs: ["Mingly dùng nhà cung cấp đăng nhập, cơ sở dữ liệu và cuộc gọi để vận hành các tính năng trên. Dữ liệu được chia sẻ với họ trong phạm vi cần thiết để cung cấp dịch vụ; chúng tôi cũng có thể cung cấp dữ liệu khi pháp luật yêu cầu.", "Chúng tôi dùng kiểm tra quyền truy cập ở máy chủ để giới hạn ai được vào phòng và xem dữ liệu phòng. Không hệ thống nào có thể bảo đảm an toàn tuyệt đối."] },
      { title: "Lưu giữ và lựa chọn của bạn", paragraphs: ["Dữ liệu tài khoản và các phòng chưa bị xóa có thể tiếp tục được lưu. Mingly hiện chưa có nút tự xóa tài khoản trong ứng dụng. Đăng xuất hoặc thu hồi quyền Google không tự xóa hồ sơ, phòng hay tin nhắn đã lưu.", "Chính sách này sẽ được cập nhật khi cách Mingly xử lý dữ liệu thay đổi. Ngày cập nhật ở đầu trang cho biết phiên bản hiện tại."] },
      { title: "Dữ liệu từ Google", paragraphs: ["Việc sử dụng và chuyển dữ liệu nhận từ Google API Services tuân theo Google API Services User Data Policy, gồm các yêu cầu Limited Use. Mingly chỉ dùng dữ liệu đó cho các tính năng được mô tả ở trên."] },
    ],
  },
  en: {
    title: "Privacy Policy",
    summary: "What Mingly uses when you sign in and join a room.",
    backLabel: "Back to home",
    updatedLabel: "Updated",
    updatedAt: "03/11/2026",
    sections: [
      { title: "Sign-in", paragraphs: ["If you sign in with Google, Mingly receives basic profile information from your account, such as your name, email address, and profile picture. We use it to sign you in, create your profile, and help people in your room recognize you. Mingly does not use your Google data for advertising or sell it to others.", "You can sign out in the app or revoke access in your Google Account. Revoking access does not automatically delete data already stored by Mingly."] },
      { title: "Room data", paragraphs: ["We store room details, access settings, messages, whiteboards, and video selections so rooms can work. People in your room can see your display name, profile picture if available, presence, and content you send.", "Room hosts can use the room management tools. When a host deletes a room, data linked to it in the database, including messages and whiteboards, is deleted too. Ending a room only closes access; its data remains stored."] },
      { title: "Calls and video", paragraphs: ["Audio, camera video, and screen sharing pass through our call provider so people in the room can hear and see them. Mingly has no call recording feature. Other participants may still record their screens with their own tools.", "You can turn off your microphone, camera, or screen sharing at any time. YouTube videos play in YouTube's embedded player, and YouTube may process data under its own policy."] },
      { title: "Providers and security", paragraphs: ["Mingly uses sign-in, database, and call providers to run these features. Data is shared with them as needed to provide the service. We may also disclose data when required by law.", "We check access on the server to limit who can enter rooms and view room data. No system can guarantee complete security."] },
      { title: "Retention and your choices", paragraphs: ["Account data and rooms that have not been deleted may remain stored. Mingly does not currently offer an in-app account deletion button. Signing out or revoking Google access does not automatically delete stored profiles, rooms, or messages.", "We will update this policy if the way Mingly handles data changes. The date at the top shows the current version."] },
      { title: "Google data", paragraphs: ["Our use and transfer of data received from Google API Services follows the Google API Services User Data Policy, including its Limited Use requirements. Mingly uses that data only for the features described above."] },
    ],
  },
};

export default function PrivacyPage() {
  return <LegalPage copies={copies} />;
}
