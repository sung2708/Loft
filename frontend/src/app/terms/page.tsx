import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Điều khoản sử dụng",
    summary: "Các điều khoản này quy định cách sử dụng Mingly, một không gian để tạo phòng, trò chuyện và chia sẻ nội dung với những người bạn mời.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật lần cuối",
    sections: [
      { title: "Sử dụng dịch vụ", paragraphs: ["Bạn chỉ sử dụng Mingly cho mục đích hợp pháp, tôn trọng người khác và tuân thủ điều khoản của các dịch vụ liên kết như Google, YouTube và LiveKit."] },
      { title: "Phòng và quyền quản trị", paragraphs: ["Chủ phòng chịu trách nhiệm về người được mời, cài đặt khách, mật khẩu, khóa phòng và các thao tác quản trị. Chủ phòng có thể mời, xóa hoặc chặn thành viên theo quyền được cấp trong ứng dụng."] },
      { title: "Nội dung và hành vi bị cấm", paragraphs: ["Không dùng Mingly để quấy rối, lừa đảo, xâm phạm quyền riêng tư, phát tán nội dung bất hợp pháp hoặc cố gắng truy cập trái phép vào phòng, tài khoản hay hệ thống."] },
      { title: "Dịch vụ bên thứ ba", paragraphs: ["Một số tính năng phụ thuộc vào dịch vụ bên thứ ba. Việc các dịch vụ này gián đoạn, thay đổi hoặc từ chối yêu cầu có thể ảnh hưởng đến một phần chức năng của Mingly."] },
      { title: "Thay đổi dịch vụ", paragraphs: ["Mingly có thể cập nhật, giới hạn hoặc ngừng một tính năng để bảo mật, bảo trì hoặc cải thiện dịch vụ. Điều khoản mới sẽ được công bố tại trang này."] },
    ],
  },
  en: {
    title: "Terms of Service",
    summary: "These terms govern your use of Mingly, a space for creating rooms, talking, and sharing content with people you invite.",
    backLabel: "Back to home",
    updatedLabel: "Last updated",
    sections: [
      { title: "Using the service", paragraphs: ["Use Mingly only for lawful purposes, respect other people, and comply with the terms of connected services such as Google, YouTube, and LiveKit."] },
      { title: "Rooms and moderation", paragraphs: ["Room hosts are responsible for the people they invite and for guest access, passwords, room locks, and moderation actions. Hosts can invite, remove, or block participants through the permissions provided in the app."] },
      { title: "Prohibited conduct", paragraphs: ["Do not use Mingly to harass, defraud, invade privacy, distribute unlawful content, or attempt unauthorized access to a room, account, or system."] },
      { title: "Third-party services", paragraphs: ["Some features rely on third-party services. An interruption, change, or refusal by those services may affect part of Mingly's functionality."] },
      { title: "Service changes", paragraphs: ["Mingly may update, limit, or discontinue a feature for security, maintenance, or service improvement. Updated terms will be published on this page."] },
    ],
  },
};

export default function TermsPage() {
  return <LegalPage copies={copies} />;
}
