import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Điều khoản sử dụng",
    summary: "Các điều khoản này quy định quyền, trách nhiệm và giới hạn khi bạn dùng Mingly để tạo phòng, trò chuyện và chia sẻ nội dung.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật lần cuối",
    updatedAt: "31/10/2026",
    notice: "Mingly không phải dịch vụ khẩn cấp và không cung cấp tính năng ghi hình phòng. Không dùng dịch vụ khi bạn cần lưu trữ một bản ghi hoặc liên lạc khẩn cấp.",
    sections: [
      { title: "Chấp nhận điều khoản", paragraphs: ["Khi truy cập hoặc dùng Mingly, bạn đồng ý với các điều khoản này và Chính sách quyền riêng tư. Nếu không đồng ý, bạn không nên sử dụng dịch vụ."] },
      { title: "Tài khoản và phòng", paragraphs: ["Bạn có thể dùng Mingly với tài khoản hoặc với quyền khách do phòng cho phép. Bạn chịu trách nhiệm bảo mật thông tin đăng nhập và mọi hoạt động qua tài khoản hoặc quyền khách của mình.", "Chủ phòng chịu trách nhiệm về người được mời, quyền khách, mật khẩu, khóa phòng và thao tác quản trị. Chủ phòng có thể xóa, chặn thành viên hoặc kết thúc phòng; khi phòng kết thúc, người tham gia bị ngắt kết nối và liên kết mời không còn hoạt động."] },
      { title: "Nội dung bạn chia sẻ", paragraphs: ["Bạn giữ quyền đối với tin nhắn, nét vẽ, tên phòng, liên kết và nội dung khác do mình gửi. Bạn cho Mingly quyền giới hạn, không độc quyền và cần thiết để lưu trữ, truyền và hiển thị nội dung đó cho những người trong phòng nhằm vận hành dịch vụ.", "Bạn chịu trách nhiệm bảo đảm mình có quyền cần thiết đối với nội dung hoặc liên kết đã chia sẻ. Không được sao chép, trích xuất, tải xuống, restream hoặc né các giới hạn của dịch vụ nội dung bên thứ ba."] },
      { title: "Hành vi không được phép", paragraphs: ["Không dùng Mingly để quấy rối, lừa đảo, xâm phạm quyền riêng tư, phát tán nội dung bất hợp pháp hoặc xâm phạm quyền của người khác.", "Không truy cập trái phép vào phòng, tài khoản hoặc hệ thống; không can thiệp vào hoạt động dịch vụ, phát tán mã độc, giả mạo danh tính hay tìm cách vượt qua giới hạn quyền."] },
      { title: "YouTube và dịch vụ bên thứ ba", paragraphs: ["YouTube và các dịch vụ liên kết có điều khoản riêng. Khi dùng tính năng liên quan, bạn phải tuân thủ điều khoản áp dụng của các dịch vụ đó. Mingly không sở hữu nội dung YouTube và có thể giới hạn tính năng khi cần thiết để đáp ứng yêu cầu của nhà cung cấp, bảo mật hoặc pháp luật."] },
      { title: "Thực thi và thay đổi", paragraphs: ["Chúng tôi có thể giới hạn, đình chỉ hoặc chấm dứt quyền truy cập khi có rủi ro bảo mật, vi phạm điều khoản hoặc yêu cầu pháp lý hợp lệ.", "Chúng tôi có thể cập nhật, giới hạn hoặc ngừng một tính năng để bảo mật, bảo trì hoặc cải thiện dịch vụ. Điều khoản sửa đổi sẽ được công bố tại trang này và có hiệu lực từ ngày cập nhật, trừ khi có thông báo khác."] },
    ],
  },
  en: {
    title: "Terms of Service",
    summary: "These terms set out the rights, responsibilities, and limits that apply when you use Mingly to create rooms, talk, and share content.",
    backLabel: "Back to home",
    updatedLabel: "Last updated",
    updatedAt: "31/10/2026",
    notice: "Mingly is not an emergency service and does not provide room recording. Do not use it where you require a record or emergency communication.",
    sections: [
      { title: "Acceptance", paragraphs: ["By accessing or using Mingly, you agree to these terms and the Privacy Policy. If you do not agree, do not use the service."] },
      { title: "Accounts and rooms", paragraphs: ["You may use Mingly with an account or with guest access where a room permits it. You are responsible for safeguarding your sign-in details and for activity through your account or guest access.", "Room hosts are responsible for invitees, guest access, passwords, room locks, and moderation actions. Hosts may remove or block participants and end a room; ending a room disconnects participants and disables its invite link."] },
      { title: "Your content", paragraphs: ["You retain rights in messages, drawings, room names, links, and other content you submit. You grant Mingly the limited, non-exclusive right needed to store, transmit, and display that content to people in the room in order to operate the service.", "You are responsible for having the rights needed for content or links you share. Do not copy, extract, download, restream, or bypass limitations of third-party content services."] },
      { title: "Prohibited conduct", paragraphs: ["Do not use Mingly to harass, defraud, invade privacy, distribute unlawful content, or infringe another person's rights.", "Do not gain unauthorized access to a room, account, or system; interfere with the service; distribute malware; impersonate another person; or bypass permission limits."] },
      { title: "YouTube and third-party services", paragraphs: ["YouTube and connected services have their own terms. When using a related feature, you must comply with their applicable terms. Mingly does not own YouTube content and may limit a feature when needed to meet a provider, security, or legal requirement."] },
      { title: "Enforcement and changes", paragraphs: ["We may limit, suspend, or end access where there is a security risk, a violation of these terms, or a valid legal requirement.", "We may update, limit, or discontinue a feature for security, maintenance, or service improvement. Revised terms will be published on this page and take effect on the updated date unless we state otherwise."] },
    ],
  },
};

export default function TermsPage() {
  return <LegalPage copies={copies} />;
}
